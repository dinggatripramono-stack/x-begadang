"""Unit tests for X-BEGADANG core logic:
- Ultradian 90-min cycle calculations
- Sleep latency adjustments
- Astronomical prayer calculations
- Qailullah zone detection
- Sleep audit scoring engine
"""
import math
import datetime
import unittest

def calculate_prayer_times(lat, lon, tz_offset, date=None):
    if date is None:
        date = datetime.date.today()
    year, month, day = date.year, date.month, date.day
    if month <= 2:
        year -= 1
        month += 12
    a = math.floor(year / 100)
    b = 2 - a + math.floor(a / 4)
    jd = math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1)) + day + b - 1524.5
    
    d = jd - 2451545.0
    g = (357.529 + 0.98560028 * d) % 360
    q = (280.459 + 0.98564736 * d) % 360
    l = (q + 1.915 * math.sin(math.radians(g)) + 0.020 * math.sin(math.radians(2 * g))) % 360
    e = 23.439 - 0.00000036 * d
    ra = math.degrees(math.atan2(math.cos(math.radians(e)) * math.sin(math.radians(l)), math.cos(math.radians(l)))) / 15.0
    if ra < 0:
        ra += 24.0
    dec = math.degrees(math.asin(math.sin(math.radians(e)) * math.sin(math.radians(l))))
    
    eqt = (q / 15.0 - ra) % 24
    if eqt > 12: eqt -= 24
    
    transit = (12.0 + tz_offset - (lon / 15.0) - eqt) % 24.0
    
    def sun_angle_time(angle, direction=1):
        cos_h = (math.sin(math.radians(angle)) - math.sin(math.radians(lat)) * math.sin(math.radians(dec))) / (math.cos(math.radians(lat)) * math.cos(math.radians(dec)))
        if cos_h > 1.0 or cos_h < -1.0:
            return None
        h = math.degrees(math.acos(cos_h)) / 15.0
        return (transit + direction * h) % 24.0
            
    fajr = sun_angle_time(-20.0, -1)
    sunrise = sun_angle_time(-0.833, -1)
    dhuhr = transit
    alt_asr = math.degrees(math.atan(1.0 / (1.0 + math.tan(math.radians(abs(lat - dec))))))
    asr = sun_angle_time(alt_asr, 1)
    maghrib = sun_angle_time(-0.833, 1)
    isha = sun_angle_time(-18.0, 1)
    
    def fmt(t):
        if t is None: return '--:--'
        sec = round((t % 24.0) * 3600)
        h = (sec // 3600) % 24
        m = (sec % 3600) // 60
        return f'{h:02d}:{m:02d}'
        
    times = {
        'Subuh': fmt(fajr),
        'Syuruq': fmt(sunrise),
        'Dzuhur': fmt(dhuhr),
        'Ashar': fmt(asr),
        'Maghrib': fmt(maghrib),
        'Isya': fmt(isha)
    }
    if fajr is not None and maghrib is not None:
        night_len = (fajr + 24.0 - maghrib) if fajr < maghrib else (fajr - maghrib)
        last_third = (fajr + 24.0 - (night_len / 3.0)) % 24.0
        times['Tahajjud_Mulai'] = fmt(last_third)
    return times

def calculate_bedtimes(target_wake_str, latency_min=14):
    """Given wake time 'HH:MM', return bedtimes for cycles 1..6."""
    wh, wm = map(int, target_wake_str.split(':'))
    wake_minutes = wh * 60 + wm
    
    results = []
    # 6 down to 1 cycles
    for cycles in [6, 5, 4, 3, 2, 1]:
        sleep_min = cycles * 90
        total_back = sleep_min + latency_min
        bed_min = (wake_minutes - total_back) % 1440
        bh = bed_min // 60
        bm = bed_min % 60
        duration_hours = sleep_min / 60.0
        
        is_golden = (cycles == 5)
        is_optimal = (cycles == 4)
        is_deep = (cycles == 6)
        
        results.append({
            'cycles': cycles,
            'bedtime': f'{bh:02d}:{bm:02d}',
            'sleep_hours': duration_hours,
            'is_golden': is_golden,
            'is_optimal': is_optimal,
            'is_deep': is_deep
        })
    return results

def calculate_wake_times(sleep_now_dt=None, latency_min=14):
    """Given sleep time now, calculate wake times for cycles 1..6."""
    if sleep_now_dt is None:
        sleep_now_dt = datetime.datetime.now()
    now_min = sleep_now_dt.hour * 60 + sleep_now_dt.minute
    
    results = []
    for cycles in [1, 2, 3, 4, 5, 6]:
        sleep_min = cycles * 90
        total_forward = latency_min + sleep_min
        wake_min = (now_min + total_forward) % 1440
        wh = wake_min // 60
        wm = wake_min % 60
        duration_hours = sleep_min / 60.0
        
        results.append({
            'cycles': cycles,
            'waketime': f'{wh:02d}:{wm:02d}',
            'sleep_hours': duration_hours,
            'is_golden': (cycles == 5),
            'is_optimal': (cycles == 4)
        })
    return results

def get_qailullah_zone(hour_float):
    """Determine Qailullah biological and sunnah status based on hour of day."""
    if 11.5 <= hour_float <= 13.75:
        return {
            'status': 'GOLDEN',
            'label': 'Zona Emas Sunnah & Sirkadian (Sangat Dianjurkan)',
            'desc': 'Waktu optimal qailullah sebelum/setelah Dzuhur sesuai hadits Shahih dan post-prandial circadian dip.'
        }
    elif 9.0 <= hour_float < 11.5:
        return {
            'status': 'NEUTRAL',
            'label': 'Zona Netral (Pagi Menjelang Siang)',
            'desc': 'Boleh jika kondisi fisik sangat letih, namun durasi dibatasi maksimal 15-20 menit.'
        }
    elif 13.75 < hour_float <= 15.0:
        return {
            'status': 'WARNING',
            'label': 'Zona Akhir Dzuhur (Batas Aman Terakhir)',
            'desc': 'Ambil power nap maksimal 15 menit agar tidak berbenturan dengan waktu Ashar.'
        }
    elif 15.0 < hour_float <= 18.0:
        return {
            'status': 'DANGER',
            'label': 'Zona Makruh / Bahaya Sirkadian (Pasca Ashar)',
            'desc': 'Tidur di waktu ini merusak akumulasi adenosine malam hari, memicu disorientasi (grogginess), dan dimakruhkan para salaf.'
        }
    else:
        return {
            'status': 'REST',
            'label': 'Bukan Waktu Tidur Siang',
            'desc': 'Fokus pada aktivitas produktif atau persiapan tidur malam.'
        }

def evaluate_sleep_audit(answers):
    """Evaluate 10 diagnostic questions (0 to 10 points each, max 100)."""
    score = sum(answers)
    if score >= 85:
        grade = 'A'
        title = 'Sultan Fajar (Optimal & Sehat)'
        summary = 'Kualitas tidur dan ritme sirkadian Anda sangat prima. Pertahankan konsistensi ini.'
    elif score >= 70:
        grade = 'B'
        title = 'Pejuang Konsisten (Baik & Terjaga)'
        summary = 'Tidur Anda cukup berkualitas, namun ada 1-2 aspek kecil yang perlu disempurnakan.'
    elif score >= 55:
        grade = 'C'
        title = 'Defisit Ringan (Perlu Penyesuaian)'
        summary = 'Ada akumulasi hutang tidur atau gangguan kebiasaan malam yang mulai membebani kognisi.'
    elif score >= 40:
        grade = 'D'
        title = 'Kronis Begadang (Beresiko Tinggi)'
        summary = 'Pola tidur Anda acak, adenosine tidak terbersihkan tuntas, dan berpotensi memicu sleep inertia kronis.'
    else:
        grade = 'F'
        title = 'Darurat Sirkadian (Segera Pulihkan)'
        summary = 'Kualitas tidur sangat buruk. Tubuh dan otak Anda berada dalam mode kelelahan berkepanjangan.'
    return {'score': score, 'grade': grade, 'title': title, 'summary': summary}


class TestXBegadangCore(unittest.TestCase):
    def test_prayer_times(self):
        times = calculate_prayer_times(-6.2, 106.8, 7.0)
        self.assertIn('Subuh', times)
        self.assertIn('Dzuhur', times)
        self.assertIn('Ashar', times)
        self.assertIn('Maghrib', times)
        self.assertIn('Isya', times)
        self.assertIn('Tahajjud_Mulai', times)
        self.assertTrue(len(times['Subuh']) == 5)
        print('Calculated Jakarta Times:', times)

    def test_cycle_bedtimes(self):
        # Target wake: 04:30
        res = calculate_bedtimes('04:30', latency_min=15)
        self.assertEqual(len(res), 6)
        # 5 cycles = 450m + 15m = 465m before 04:30 (270 min from midnight)
        # 270 - 465 = -195 -> 1440 - 195 = 1245 min = 20:45
        c5 = [x for x in res if x['cycles'] == 5][0]
        self.assertEqual(c5['bedtime'], '20:45')
        self.assertTrue(c5['is_golden'])

    def test_qailullah_zones(self):
        z_noon = get_qailullah_zone(12.5)
        self.assertEqual(z_noon['status'], 'GOLDEN')
        z_asr = get_qailullah_zone(16.0)
        self.assertEqual(z_asr['status'], 'DANGER')

    def test_audit(self):
        perfect = evaluate_sleep_audit([10]*10)
        self.assertEqual(perfect['grade'], 'A')
        self.assertEqual(perfect['score'], 100)
        
        poor = evaluate_sleep_audit([3]*10)
        self.assertEqual(poor['grade'], 'F')
        self.assertEqual(poor['score'], 30)

if __name__ == '__main__':
    unittest.main()
