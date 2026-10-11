/**
 * X-BEGADANG - Standalone Sleep Architecture & Sunnah Wake Engine
 * Crafted for Boss Dingga with Zero-Defect Precision
 */

// ==========================================
// 1. STATE & STORAGE MANAGEMENT
// ==========================================
const STORAGE_KEY = 'X_BEGADANG_DATA_V1';

const DEFAULT_STATE = {
  settings: {
    lat: -6.2088,
    lon: 106.8456,
    cityName: 'Jakarta / Jawa Barat',
    tzOffset: 7,
    latencyMin: 14,
    soundProfile: 'binaural',
    volume: 0.8
  },
  streak: {
    count: 0,
    lastCheckInDate: null,
    history: []
  },
  quickWins: {
    date: null,
    dzikir: false,
    water: false,
    sunlight: false,
    stretch: false
  },
  journalEntries: [],
  auditResult: null,
  activeAlarm: null // { time: 'HH:MM', timestamp: ms, label: '5 Siklus Emas' }
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...parsed, settings: { ...DEFAULT_STATE.settings, ...parsed.settings } };
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

let AppState = loadState();

// ==========================================
// 2. ASTRONOMICAL PRAYER TIMES ENGINE
// ==========================================
function getNowInTZ(tzOffset = 7) {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * tzOffset));
}

function getTimezoneLabel(tzOffset = 7) {
  if (tzOffset === 7) return 'WIB';
  if (tzOffset === 8) return 'WITA';
  if (tzOffset === 9) return 'WIT';
  const sign = tzOffset >= 0 ? '+' : '';
  return `GMT${sign}${tzOffset}`;
}

function calculatePrayerTimes(lat, lon, tzOffset, date = null) {
  if (!date) {
    date = getNowInTZ(tzOffset);
  }
  const year = date.getFullYear();
  let month = date.getMonth() + 1;
  const day = date.getDate();
  let y = year;

  if (month <= 2) {
    y -= 1;
    month += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
  const d = jd - 2451545.0;

  const toRad = deg => (deg * Math.PI) / 180.0;
  const toDeg = rad => (rad * 180.0) / Math.PI;

  const g = (357.529 + 0.98560028 * d) % 360;
  const q = (280.459 + 0.98564736 * d) % 360;
  const l = (q + 1.915 * Math.sin(toRad(g)) + 0.02 * Math.sin(toRad(2 * g))) % 360;
  const e = 23.439 - 0.00000036 * d;

  let ra = toDeg(Math.atan2(Math.cos(toRad(e)) * Math.sin(toRad(l)), Math.cos(toRad(l)))) / 15.0;
  if (ra < 0) ra += 24.0;
  const dec = toDeg(Math.asin(Math.sin(toRad(e)) * Math.sin(toRad(l))));

  let eqt = (q / 15.0 - ra) % 24;
  if (eqt > 12) eqt -= 24;

  const transit = (12.0 + tzOffset - lon / 15.0 - eqt + 24.0) % 24.0;

  function sunAngleTime(angle, direction = 1) {
    const cosH = (Math.sin(toRad(angle)) - Math.sin(toRad(lat)) * Math.sin(toRad(dec))) /
                 (Math.cos(toRad(lat)) * Math.cos(toRad(dec)));
    if (cosH > 1.0 || cosH < -1.0) return null;
    const h = toDeg(Math.acos(cosH)) / 15.0;
    return (transit + direction * h + 24.0) % 24.0;
  }

  const fajr = sunAngleTime(-20.0, -1); // 20 deg Kemenag
  const sunrise = sunAngleTime(-0.833, -1);
  const dhuhr = transit;
  const altAsr = toDeg(Math.atan(1.0 / (1.0 + Math.tan(toRad(Math.abs(lat - dec))))));
  const asr = sunAngleTime(altAsr, 1);
  const maghrib = sunAngleTime(-0.833, 1);
  const isha = sunAngleTime(-18.0, 1);

  // Dhuha: ~20 mins after sunrise
  const dhuha = sunrise !== null ? (sunrise + 20 / 60.0) % 24.0 : null;

  function fmt(t) {
    if (t === null || isNaN(t)) return '--:--';
    const sec = Math.round((((t % 24.0) + 24.0) % 24.0) * 3600);
    const hh = Math.floor(sec / 3600) % 24;
    const mm = Math.floor((sec % 3600) / 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  const result = {
    Subuh: fmt(fajr),
    Syuruq: fmt(sunrise),
    Dhuha: fmt(dhuha),
    Dzuhur: fmt(dhuhr),
    Ashar: fmt(asr),
    Maghrib: fmt(maghrib),
    Isya: fmt(isha),
    raw: { fajr, sunrise, dhuha, dhuhr, asr, maghrib, isha }
  };

  if (fajr !== null && maghrib !== null) {
    const nightLen = fajr < maghrib ? fajr + 24.0 - maghrib : fajr - maghrib;
    const lastThird = ((fajr + 24.0 - nightLen / 3.0) % 24.0);
    result.Tahajjud = fmt(lastThird);
    result.raw.tahajjud = lastThird;
  } else {
    result.Tahajjud = '01:30';
  }

  return result;
}

// ==========================================
// 3. SLEEP CYCLE & ULTRADIAN MATHEMATICS
// ==========================================
function calculateBedtimesForWake(wakeTimeStr, latencyMin = 14) {
  const [wh, wm] = wakeTimeStr.split(':').map(Number);
  const wakeMinutes = wh * 60 + wm;

  const cycleDefinitions = [
    { cycles: 6, label: '9.0 Jam (Pemulihan Total / Recovery)', tag: 'RECOVERY', badgeClass: 'badge-cyan', desc: 'Sangat cocok saat tubuh habis sakit, olahraga berat, atau bayar hutang tidur parah.' },
    { cycles: 5, label: '7.5 Jam (Zona Emas Bio-Human)', tag: 'GOLDEN', badgeClass: 'badge-gold', desc: 'Rekomendasi Utama Konsensus Medis & Neurobiologi. 0% Sleep Inertia, daya ingat maksimal.' },
    { cycles: 4, label: '6.0 Jam (Minimum Produktif Aman)', tag: 'OPTIMAL', badgeClass: 'badge-emerald', desc: 'Batas ideal harian untuk produktivitas tinggi jika dipadukan dengan Qailullah 20 menit siang.' },
    { cycles: 3, label: '4.5 Jam (Siklus Pendek Darurat)', tag: 'SHORT', badgeClass: 'badge-amber', desc: 'Gunakan hanya dalam keadaan mendesak. Adenosine belum tereliminasi sempurna.' },
    { cycles: 2, label: '3.0 Jam (Power Repair)', tag: 'WARNING', badgeClass: 'badge-rose', desc: 'Sangat pendek. Anda akan merasa agak lelah di siang hari, butuh power nap siang.' },
    { cycles: 1, label: '1.5 Jam (1 Siklus Ekstrem)', tag: 'CRITICAL', badgeClass: 'badge-rose', desc: 'Hanya 1 putaran ultradian lengkap. Bebas pening dibanding bangun di menit 45.' }
  ];

  return cycleDefinitions.map(item => {
    const sleepMin = item.cycles * 90;
    const totalBack = sleepMin + latencyMin;
    const bedMin = (wakeMinutes - totalBack + 1440 * 2) % 1440;
    const bh = Math.floor(bedMin / 60);
    const bm = bedMin % 60;
    const timeStr = `${String(bh).padStart(2, '0')}:${String(bm).padStart(2, '0')}`;

    return {
      ...item,
      bedtime: timeStr,
      sleepMinutes: sleepMin,
      totalHours: (sleepMin / 60).toFixed(1)
    };
  });
}

function calculateWakeTimesForSleepNow(latencyMin = 14) {
  const now = getNowInTZ(AppState.settings.tzOffset);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const cycleDefinitions = [
    { cycles: 1, label: '1 Siklus (1.5 Jam)', tag: 'CRITICAL', badgeClass: 'badge-rose', desc: 'Tidur darurat. Bangun di akhir REM sebelum masuk siklus baru.' },
    { cycles: 2, label: '2 Siklus (3.0 Jam)', tag: 'SHORT', badgeClass: 'badge-amber', desc: 'Restorasi minimum. Memungkinkan tubuh istirahat singkat.' },
    { cycles: 3, label: '3 Siklus (4.5 Jam)', tag: 'TAHAJJUD', badgeClass: 'badge-cyan', desc: 'Sangat cocok untuk bangun di sepertiga malam akhir / Tahajjud.' },
    { cycles: 4, label: '4 Siklus (6.0 Jam)', tag: 'OPTIMAL', badgeClass: 'badge-emerald', desc: 'Bagus untuk mengejar Subuh tepat waktu tanpa pening.' },
    { cycles: 5, label: '5 Siklus (7.5 Jam)', tag: 'GOLDEN', badgeClass: 'badge-gold', desc: 'STANDAR EMAS. Kesegaran fisik dan kognitif optimal sepanjang hari.' },
    { cycles: 6, label: '6 Siklus (9.0 Jam)', tag: 'RECOVERY', badgeClass: 'badge-cyan', desc: 'Restorasi maksimal untuk kebugaran seluler dan otak.' }
  ];

  return cycleDefinitions.map(item => {
    const sleepMin = item.cycles * 90;
    const totalForward = latencyMin + sleepMin;
    const wakeMin = (nowMinutes + totalForward) % 1440;
    const wh = Math.floor(wakeMin / 60);
    const wm = wakeMin % 60;
    const timeStr = `${String(wh).padStart(2, '0')}:${String(wm).padStart(2, '0')}`;

    return {
      ...item,
      waketime: timeStr,
      sleepMinutes: sleepMin,
      totalHours: (sleepMin / 60).toFixed(1)
    };
  });
}

// ==========================================
// 4. QAILULLAH RADAR & NAP ENGINE
// ==========================================
function getQailullahZone(date = null) {
  if (!date) {
    date = getNowInTZ(AppState.settings.tzOffset);
  }
  const h = date.getHours() + date.getMinutes() / 60.0;

  if (h >= 11.5 && h <= 13.5) {
    return {
      status: 'GOLDEN',
      label: 'ZONA EMAS SUNNAH & SIRKADIAN (11:30 - 13:30)',
      badgeClass: 'badge-gold',
      desc: 'Waktu puncak penurunan suhu tubuh alami (post-prandial dip) dan waktu Sunnah Qailullah terbaik. Mengembalikan fokus tanpa merusak tidur malam.'
    };
  } else if (h >= 9.0 && h < 11.5) {
    return {
      status: 'NEUTRAL',
      label: 'ZONA NETRAL (09:00 - 11:30)',
      badgeClass: 'badge-cyan',
      desc: 'Boleh jika semalam kurang tidur parah, namun batasi maksimal 20 menit agar ritme siang tetap aktif.'
    };
  } else if (h > 13.5 && h <= 15.0) {
    return {
      status: 'WARNING',
      label: 'ZONA PENUTUP DZUHUR (13:30 - 15:00)',
      badgeClass: 'badge-amber',
      desc: 'Batas akhir waktu aman tidur siang. Segera bangun sebelum masuk Ashar agar tidak menimbulkan kantuk berlebih.'
    };
  } else if (h > 15.0 && h <= 18.0) {
    return {
      status: 'DANGER',
      label: 'ZONA BAHAYA / MAKRUH (Pasca Ashar s/d Maghrib)',
      badgeClass: 'badge-rose',
      desc: 'DILARANG / MAKRUH. Tidur setelah Ashar menyebabkan disorientasi hebat (Sleep Inertia parah) dan menghabiskan simpanan Adenosine sehingga Anda PASTI BEGADANG malam ini.'
    };
  } else {
    return {
      status: 'NIGHT',
      label: 'FASE MALAM / PERSIAPAN TIDUR',
      badgeClass: 'badge-slate',
      desc: 'Bukan waktu tidur siang. Fokus pada ibadah malam dan persiapan tidur utama.'
    };
  }
}

// ==========================================
// 5. WEB AUDIO API ALARM SYNTHESIZER
// ==========================================
class SleepAudioSynthesizer {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.activeNodes = [];
    this.timerId = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playProfile(profile = 'binaural', volume = 0.8) {
    this.init();
    if (!this.ctx) return;
    this.stop();
    this.isPlaying = true;

    if (profile === 'binaural') {
      this.playBinauralWake(volume);
    } else if (profile === 'tibetan') {
      this.playTibetanBowl(volume);
    } else if (profile === 'chime') {
      this.playHarmonicChime(volume);
    } else if (profile === 'adzan') {
      this.playAdzanMelody(volume);
    } else {
      this.playHarmonicChime(volume);
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.activeNodes.forEach(n => {
      try {
        if (n.stop) n.stop();
        if (n.disconnect) n.disconnect();
      } catch (e) {}
    });
    this.activeNodes = [];
  }

  playBinauralWake(vol) {
    // 432 Hz root + 528 Hz harmonic gentle pulsing
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const playBell = () => {
      if (!this.isPlaying) return;
      const t = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(432, t);
      osc1.frequency.exponentialRampToValueAtTime(528, t + 1.8);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(216, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(vol * 0.45, t + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 2.8);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 2.9);
      osc2.stop(t + 2.9);

      this.activeNodes.push(osc1, osc2, gain);
    };

    playBell();
    this.timerId = setInterval(playBell, 3200);
  }

  playTibetanBowl(vol) {
    const ctx = this.ctx;
    const playStroke = () => {
      if (!this.isPlaying) return;
      const t = ctx.currentTime;
      const freqs = [174, 285, 396, 528];
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.001, t);
      masterGain.gain.linearRampToValueAtTime(vol * 0.35, t + 0.3);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
      masterGain.connect(ctx.destination);

      freqs.forEach(f => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t);
        osc.connect(masterGain);
        osc.start(t);
        osc.stop(t + 4.0);
        this.activeNodes.push(osc);
      });
      this.activeNodes.push(masterGain);
    };

    playStroke();
    this.timerId = setInterval(playStroke, 4200);
  }

  playHarmonicChime(vol) {
    const ctx = this.ctx;
    const playArp = () => {
      if (!this.isPlaying) return;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const t = ctx.currentTime + idx * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(vol * 0.4, t + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 1.5);
        this.activeNodes.push(osc, gain);
      });
    };

    playArp();
    this.timerId = setInterval(playArp, 2800);
  }

  playAdzanMelody(vol) {
    const ctx = this.ctx;
    // Pentatonic modal chime sequence (D4, F4, G4, A4, C5, D5)
    const seq = [293.66, 349.23, 392.00, 440.00, 523.25, 587.33];
    const playPhrase = () => {
      if (!this.isPlaying) return;
      seq.forEach((freq, idx) => {
        const t = ctx.currentTime + idx * 0.35;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(vol * 0.35, t + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 1.3);
        this.activeNodes.push(osc, gain);
      });
    };

    playPhrase();
    this.timerId = setInterval(playPhrase, 3600);
  }
}

const AudioEngine = new SleepAudioSynthesizer();

// ==========================================
// 6. SLEEP AUDIT SCORING (PSQI ADAPTED)
// ==========================================
const AUDIT_QUESTIONS = [
  {
    id: 1,
    title: 'Durasi Tidur Rata-Rata',
    desc: 'Berapa jam total tidur murni Anda setiap malam?',
    options: [
      { text: '7.5 – 9 jam (5 – 6 Siklus Penuh)', score: 10 },
      { text: '6 – 7.4 jam (4 Siklus Lengkap)', score: 8 },
      { text: '5 – 5.9 jam (Kurang dari 4 siklus)', score: 5 },
      { text: '< 5 jam (Kronis Kurang Tidur)', score: 1 }
    ]
  },
  {
    id: 2,
    title: 'Sleep Latency (Kecepatan Terlelap)',
    desc: 'Berapa lama waktu dari Anda meletakkan kepala hingga benar-benar tertidur?',
    options: [
      { text: '10 – 20 menit (Ideal & Seimbang)', score: 10 },
      { text: '< 5 menit (Tanda kelelahan ekstrem/sleep deprivation)', score: 6 },
      { text: '25 – 45 menit (Sering overthinking/gelisah)', score: 4 },
      { text: '> 45 menit (Insomnia latensi tinggi)', score: 1 }
    ]
  },
  {
    id: 3,
    title: 'Frekuensi Terbangun Tengah Malam',
    desc: 'Apakah Anda sering terjaga di tengah malam dan sulit tidur lagi?',
    options: [
      { text: 'Jarang sekali / Tidur nyenyak sampai bangun Subuh', score: 10 },
      { text: '1 kali sebentar lalu tidur lagi dengan mudah', score: 8 },
      { text: '2-3 kali terbangun dan butuh waktu lama untuk tidur', score: 4 },
      { text: 'Sering terbangun gelisah / insomnia fragmentasi', score: 1 }
    ]
  },
  {
    id: 4,
    title: 'Waktu Terakhir Konsumsi Kafein',
    desc: 'Jam berapa biasanya Anda meminum kopi, teh pekat, atau suplemen berkafein?',
    options: [
      { text: 'Hanya pagi hari (Sebelum jam 12:00 siang)', score: 10 },
      { text: 'Maksimal jam 14:00 siang (Masih aman)', score: 8 },
      { text: 'Sore hari (16:00 – 18:00)', score: 4 },
      { text: 'Malam hari setelah Isya / Menjelang tidur', score: 1 }
    ]
  },
  {
    id: 5,
    title: 'Paparan Layar Gadget Sebelum Tidur',
    desc: 'Apakah Anda menatap layar HP/Laptop/TV dalam 60 menit sebelum memejamkan mata?',
    options: [
      { text: 'Tidak sama sekali / Digital Detox 60 menit sebelum tidur', score: 10 },
      { text: 'Kadang-kadang dengan Night Shift / Filter Blue Light aktif', score: 7 },
      { text: 'Selalu main HP hingga mata terasa lelah', score: 3 },
      { text: 'Scrolling medsos sambil rebahan di ranjang sampai tertidur', score: 0 }
    ]
  },
  {
    id: 6,
    title: 'Konsistensi Bangun Subuh',
    desc: 'Seberapa konsisten Anda bangun sebelum atau saat adzan Subuh?',
    options: [
      { text: 'Sangat konsisten setiap hari (Bahkan untuk Tahajjud)', score: 10 },
      { text: 'Sebagian besar hari tepat waktu saat adzan Subuh', score: 8 },
      { text: 'Sering mepet Syuruq atau terlambat beberapa kali', score: 4 },
      { text: 'Sering bablas sampai jam 7-8 pagi karena begadang', score: 1 }
    ]
  },
  {
    id: 7,
    title: 'Tingkat Kantuk di Siang Hari (Daytime Fatigue)',
    desc: 'Bagaimana tingkat energi dan fokus Anda saat jam 10:00 – 15:00 siang?',
    options: [
      { text: 'Segar, fokus, dan stabil berenergi', score: 10 },
      { text: 'Agak lelah wajar, pulih setelah Qailullah 20 menit', score: 8 },
      { text: 'Sering mengantuk berat dan butuh dorongan kopi ekstra', score: 4 },
      { text: 'Brain fog parah, mengantuk tak tertahankan di siang hari', score: 1 }
    ]
  },
  {
    id: 8,
    title: 'Lingkungan Kamar Tidur (Gelap & Suhu)',
    desc: 'Bagaimana kondisi kamar tidur Anda saat malam hari?',
    options: [
      { text: 'Gelap gulita (Pitch Black), sejuk (19-22°C), tenang', score: 10 },
      { text: 'Cukup redup dengan lampu tidur kecil dan sejuk', score: 8 },
      { text: 'Lampu terang atau suhu ruangan agak panas', score: 4 },
      { text: 'Lampu terang benderang dan bising suara perangkat', score: 2 }
    ]
  },
  {
    id: 9,
    title: 'Kebiasaan Tidur Pasca Ashar',
    desc: 'Apakah Anda sering tidur di sore hari antara waktu Ashar sampai Maghrib?',
    options: [
      { text: 'Tidak pernah sama sekali (Menjaga Sunnah & Sirkadian)', score: 10 },
      { text: 'Sangat jarang, hanya jika demam/sakit', score: 8 },
      { text: 'Kadang-kadang 1-2 kali seminggu', score: 4 },
      { text: 'Sering ketiduran sore dan bangun dengan kepala pening', score: 1 }
    ]
  },
  {
    id: 10,
    title: 'Keteraturan Jadwal (Social Jetlag)',
    desc: 'Seberapa konsisten jam tidur Anda antara hari kerja vs akhir pekan?',
    options: [
      { text: 'Selalu sama (Selisih waktu tidur < 30 menit)', score: 10 },
      { text: 'Selisih waktu tidur sekitar 1 jam di akhir pekan', score: 8 },
      { text: 'Selisih 2-3 jam lebih larut di akhir pekan', score: 4 },
      { text: 'Sangat berantakan, sering begadang sampai pagi di weekend', score: 1 }
    ]
  }
];

function scoreAudit(answersArray) {
  const total = answersArray.reduce((acc, val) => acc + val, 0);
  let grade = 'F';
  let title = '';
  let badgeClass = '';
  let diagnosis = '';
  let recoveryProtocol = [];

  if (total >= 85) {
    grade = 'A';
    title = 'SULTAN FAJAR (KONDISI OPTIMAL)';
    badgeClass = 'badge-gold';
    diagnosis = 'Ritme sirkadian Anda selaras sempurna dengan biologi tubuh dan Sunnah. Fase deep sleep dan REM Anda teratur, bebas dari akumulasi hutang tidur berlebih.';
    recoveryProtocol = [
      'Pertahankan jadwal tidur konsisten jam 21:30 - 22:00.',
      'Lanjutkan Qailullah 20 menit tepat saat Dzuhur untuk menjaga lonjakan performa sore.',
      'Bantu ajak dan ingatkan rekan/keluarga pejuang fajar lainnya.'
    ];
  } else if (total >= 70) {
    grade = 'B';
    title = 'PEJUANG KONSISTEN (KONDISI BAIK)';
    badgeClass = 'badge-emerald';
    diagnosis = 'Pondasi tidur Anda sudah bagus, namun ada 1-2 faktor penghambat (seperti paparan blue light sebelum tidur atau asupan kafein yang terlalu sore).';
    recoveryProtocol = [
      'Terapkan Digital Detox ketat: Jauhkan HP 45 menit sebelum tidur.',
      'Stop kafein (kopi/teh) setelah pukul 14:00 siang (ingat half-life kafein 6 jam).',
      'Pastikan kamar gelap total untuk memaksimalkan sekresi melatonin alami.'
    ];
  } else if (total >= 55) {
    grade = 'C';
    title = 'DEFISIT RINGAN (PERLU PERBAIKAN)';
    badgeClass = 'badge-amber';
    diagnosis = 'Tubuh Anda mulai mengalami akumulasi adenosine (hutang tidur). Anda sering merasakan brain fog di siang hari dan rentan terserang sleep inertia.';
    recoveryProtocol = [
      'Kunci jam bangun yang sama setiap hari (misal jam 04:30) selama 7 hari berturut-turut.',
      'Lakukan Qailullah 20 menit saat siang (hindari tidur sore pasca Ashar).',
      'Dapatkan paparan sinar matahari langsung 10 menit di pagi hari setelah Subuh untuk me-reset SCN.'
    ];
  } else if (total >= 40) {
    grade = 'D';
    title = 'KRONIS BEGADANG (RISIKO TINGGI)';
    badgeClass = 'badge-rose';
    diagnosis = 'Ritme sirkadian Anda mengalami desinkronisasi serius. Gelombang delta slow-wave sleep Anda terpotong, memicu penurunan imunitas, fokus, dan mood.';
    recoveryProtocol = [
      'Program Reset 7 Hari: Paksa tidur maksimal 5 siklus (misal tidur 21:45 bangun 04:30).',
      'Haramkan kopi setelah jam 12:00 siang.',
      'Lakukan Cognitive Offloading (Worry Dump) sebelum tidur agar tidak overthinking di ranjang.',
      'Wajib mandi air hangat 90 menit sebelum tidur untuk menurunkan core body temperature.'
    ];
  } else {
    grade = 'F';
    title = 'DARURAT SIRKADIAN (SEGERA PULIHKAN)';
    badgeClass = 'badge-rose';
    diagnosis = 'Kondisi tidur Anda dalam bahaya klinis. Tubuh kehabisan cadangan pemulihan seluler, hormon kortisol meninggi di malam hari, dan risiko gangguan metabolik meningkat.';
    recoveryProtocol = [
      'Lakukan Emergency Reset: Tetapkan target tidur jam 21:30 malam ini.',
      'Singkirkan semua gadget dari kamar tidur.',
      'Berwudhu dan baca dzikir sebelum tidur dengan posisi miring ke kanan.',
      'Gunakan X-BEGADANG alarm siklus 90 menit agar bangun tanpa rasa sakit kepala.'
    ];
  }

  return { total, grade, title, badgeClass, diagnosis, recoveryProtocol };
}

// ==========================================
// 7. ACTIVE ALARM RUNTIME TICKER
// ==========================================
let alarmCheckInterval = null;

function initAlarmWatcher() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);

  alarmCheckInterval = setInterval(() => {
    if (AppState.activeAlarm) {
      renderActiveAlarmBanner(); // Live countdown update
      const now = Date.now();
      if (now >= AppState.activeAlarm.timestamp) {
        // Trigger alarm!
        triggerAlarmRing(AppState.activeAlarm);
      }
    }
  }, 1000);
}

function setAlarmTime(hoursStr, minutesStr, label = 'Alarm Siklus Tidur') {
  const [targetH, targetM] = [parseInt(hoursStr), parseInt(minutesStr)];
  const tzNow = getNowInTZ(AppState.settings.tzOffset);
  const now = new Date();

  const curMinutes = tzNow.getHours() * 60 + tzNow.getMinutes();
  const targetMinutes = targetH * 60 + targetM;
  let diffMinutes = targetMinutes - curMinutes;
  if (diffMinutes <= 0) {
    diffMinutes += 1440;
  }

  const targetTimestamp = now.getTime() + (diffMinutes * 60 * 1000) - (tzNow.getSeconds() * 1000);

  AppState.activeAlarm = {
    time: `${String(targetH).padStart(2, '0')}:${String(targetM).padStart(2, '0')}`,
    timestamp: targetTimestamp,
    label: label
  };
  saveState(AppState);
  renderActiveAlarmBanner();

  // Try requesting notification permission if not yet
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  const tzLabel = getTimezoneLabel(AppState.settings.tzOffset);
  triggerToast(`Alarm aktif untuk ${AppState.activeAlarm.time} ${tzLabel}`);
}

function cancelActiveAlarm() {
  AppState.activeAlarm = null;
  saveState(AppState);
  renderActiveAlarmBanner();
  AudioEngine.stop();
  hideAlarmModal();
}

function triggerAlarmRing(alarmObj) {
  // Play sound synth
  AudioEngine.playProfile(AppState.settings.soundProfile, AppState.settings.volume);

  // Vibration for mobile devices
  if ('vibrate' in navigator) {
    navigator.vibrate([600, 250, 600, 250, 1000, 500, 1000]);
  }

  // Show notification if supported
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('X-BEGADANG: WAKTU BANGUN!', {
        body: `${alarmObj.label || 'Waktu bangun optimal telah tiba.'} Bangun segar bebas pening!`,
        icon: './icon-192.png'
      });
    } catch (e) {}
  }

  // Open modal
  showAlarmModal(alarmObj);
}

function snoozeAlarm(minutes = 9) {
  AudioEngine.stop();
  hideAlarmModal();

  const now = Date.now();
  const newTimestamp = now + minutes * 60 * 1000;
  const d = new Date(newTimestamp);

  AppState.activeAlarm = {
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    timestamp: newTimestamp,
    label: `Snooze (${minutes} Menit Micro-Cycle)`
  };
  saveState(AppState);
  renderActiveAlarmBanner();
}

function dismissAlarm() {
  AudioEngine.stop();
  hideAlarmModal();
  AppState.activeAlarm = null;
  saveState(AppState);
  renderActiveAlarmBanner();
}

// ==========================================
// 8. QAILULLAH TIMER ENGINE
// ==========================================
let qailullahTimer = null;
let qailullahTotalSec = 20 * 60;
let qailullahRemainingSec = 20 * 60;
let qailullahRunning = false;

function setQailullahDuration(minutes) {
  if (qailullahRunning) pauseQailullah();
  qailullahTotalSec = minutes * 60;
  qailullahRemainingSec = minutes * 60;
  updateQailullahUI();
}

function startQailullah() {
  if (qailullahRunning) return;
  AudioEngine.init(); // Warm up Web Audio
  qailullahRunning = true;
  document.getElementById('qailullah-play-btn').textContent = 'JEDA';
  document.getElementById('qailullah-play-btn').className = 'btn-gold';

  qailullahTimer = setInterval(() => {
    if (qailullahRemainingSec > 0) {
      qailullahRemainingSec--;
      updateQailullahUI();
    } else {
      // Completed!
      pauseQailullah();
      triggerAlarmRing({ label: 'Waktu Qailullah Selesai! Bangun Segar & Berenergi.' });
    }
  }, 1000);
}

function pauseQailullah() {
  qailullahRunning = false;
  if (qailullahTimer) {
    clearInterval(qailullahTimer);
    qailullahTimer = null;
  }
  const btn = document.getElementById('qailullah-play-btn');
  if (btn) {
    btn.textContent = 'MULAI QAILULLAH';
    btn.className = 'btn-emerald';
  }
}

function resetQailullah() {
  pauseQailullah();
  qailullahRemainingSec = qailullahTotalSec;
  updateQailullahUI();
}

function updateQailullahUI() {
  const display = document.getElementById('qailullah-timer-display');
  const circle = document.getElementById('qailullah-progress-circle');

  if (display) {
    const mm = Math.floor(qailullahRemainingSec / 60);
    const ss = qailullahRemainingSec % 60;
    display.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  if (circle) {
    const radius = 88;
    const circumference = 2 * Math.PI * radius;
    const progress = qailullahRemainingSec / qailullahTotalSec;
    const offset = circumference * (1 - progress);
    circle.style.strokeDashoffset = offset;
  }
}

// ==========================================
// 9. UI RENDERING & DOM INTERACTIONS
// ==========================================

function switchTab(tabId) {
  // Hide all sections
  document.querySelectorAll('.tab-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab-btn').forEach(el => el.classList.remove('active'));

  const targetView = document.getElementById(`view-${tabId}`);
  const targetBtn = document.getElementById(`nav-btn-${tabId}`);

  if (targetView) targetView.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');

  // Trigger specific refreshes if needed
  if (tabId === 'kalkulator') {
    renderCalculatorBedtimes();
    renderCalculatorWakeTimes();
  } else if (tabId === 'qailullah') {
    renderQailullahZone();
  }
}

function getDateStrInTZ(tzDate) {
  const y = tzDate.getFullYear();
  const m = String(tzDate.getMonth() + 1).padStart(2, '0');
  const d = String(tzDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderClockAndPrayers() {
  const clockEl = document.getElementById('header-live-clock');
  const dateEl = document.getElementById('header-live-date');
  const nextPrayerEl = document.getElementById('header-next-prayer');

  const tzDate = getNowInTZ(AppState.settings.tzOffset);
  const hh = String(tzDate.getHours()).padStart(2, '0');
  const mm = String(tzDate.getMinutes()).padStart(2, '0');
  const ss = String(tzDate.getSeconds()).padStart(2, '0');
  const tzLabel = getTimezoneLabel(AppState.settings.tzOffset);
  const timeStr = `${hh}:${mm}:${ss}`;

  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dateStr = `${days[tzDate.getDay()]}, ${tzDate.getDate()} ${months[tzDate.getMonth()]} ${tzDate.getFullYear()}`;

  if (clockEl) {
    clockEl.innerHTML = `<span>${timeStr}</span> <span class="badge-tz">${tzLabel}</span>`;
  }
  if (dateEl) {
    dateEl.textContent = `${dateStr} (GMT+${AppState.settings.tzOffset})`;
  }

  // Calculate prayer times
  const pt = calculatePrayerTimes(AppState.settings.lat, AppState.settings.lon, AppState.settings.tzOffset, tzDate);

  // Render prayer bar in Dashboard
  const grid = document.getElementById('dashboard-prayers-grid');
  if (grid) {
    const items = [
      { name: 'Subuh', time: pt.Subuh, highlight: true },
      { name: 'Syuruq', time: pt.Syuruq },
      { name: 'Dhuha', time: pt.Dhuha },
      { name: 'Dzuhur', time: pt.Dzuhur },
      { name: 'Ashar', time: pt.Ashar },
      { name: 'Maghrib', time: pt.Maghrib },
      { name: 'Isya', time: pt.Isya },
      { name: 'Tahajjud', time: pt.Tahajjud, highlight: true }
    ];

    grid.innerHTML = items.map(i => `
      <div class="prayer-chip ${i.highlight ? 'prayer-chip-accent' : ''}">
        <span class="prayer-name">${i.name}</span>
        <span class="prayer-time">${i.time}</span>
      </div>
    `).join('');
  }

  // Next prayer indicator
  if (nextPrayerEl && pt.raw) {
    const curH = tzDate.getHours() + tzDate.getMinutes() / 60.0 + tzDate.getSeconds() / 3600.0;
    let nextName = 'Subuh Besok';
    let nextTimeStr = pt.Subuh;
    let nextRaw = (pt.raw.fajr + 24.0) % 24.0;

    const list = [
      { name: 'Subuh', raw: pt.raw.fajr, str: pt.Subuh },
      { name: 'Dzuhur', raw: pt.raw.dhuhr, str: pt.Dzuhur },
      { name: 'Ashar', raw: pt.raw.asr, str: pt.Ashar },
      { name: 'Maghrib', raw: pt.raw.maghrib, str: pt.Maghrib },
      { name: 'Isya', raw: pt.raw.isha, str: pt.Isya }
    ];

    for (const p of list) {
      if (p.raw !== null && p.raw > curH) {
        nextName = p.name;
        nextTimeStr = p.str;
        nextRaw = p.raw;
        break;
      }
    }

    let diffHours = nextRaw - curH;
    if (diffHours < 0) diffHours += 24;
    const diffH = Math.floor(diffHours);
    const diffM = Math.floor((diffHours - diffH) * 60);

    nextPrayerEl.innerHTML = `
      <span class="dot-indicator"></span>
      <span>${nextName} <strong>${nextTimeStr} ${tzLabel}</strong> (${diffH}j ${diffM}m lagi)</span>
    `;
  }
}

function renderCalculatorBedtimes() {
  const wakeInput = document.getElementById('calc-target-wake');
  const latencyInput = document.getElementById('calc-latency-slider');
  const latencyDisplay = document.getElementById('calc-latency-value');
  const resultsContainer = document.getElementById('calc-bedtime-results');

  if (!wakeInput || !resultsContainer) return;

  const wakeTime = wakeInput.value || '04:30';
  const latency = parseInt(latencyInput ? latencyInput.value : 14);
  if (latencyDisplay) latencyDisplay.textContent = `${latency} mnt`;

  const results = calculateBedtimesForWake(wakeTime, latency);

  resultsContainer.innerHTML = results.map(item => `
    <div class="cycle-card ${item.tag === 'GOLDEN' ? 'cycle-card-golden' : ''}">
      <div class="cycle-card-header">
        <span class="badge ${item.badgeClass}">${item.tag}</span>
        <span class="cycle-hours">${item.totalHours} Jam Tidur (${item.cycles} Siklus)</span>
      </div>
      <div class="cycle-time-row">
        <span class="cycle-time">${item.bedtime}</span>
        <button class="btn-alarm-set" onclick="setAlarmTime('${item.bedtime.split(':')[0]}', '${item.bedtime.split(':')[1]}', 'Tidur ${item.cycles} Siklus (${item.bedtime})')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          Setel Alarm Jam Ini
        </button>
      </div>
      <p class="cycle-desc">${item.desc}</p>
    </div>
  `).join('');
}

function renderCalculatorWakeTimes() {
  const latencyInput = document.getElementById('calc-latency-slider');
  const latency = parseInt(latencyInput ? latencyInput.value : 14);
  const container = document.getElementById('calc-waketime-results');

  if (!container) return;

  const results = calculateWakeTimesForSleepNow(latency);

  container.innerHTML = results.map(item => `
    <div class="cycle-card ${item.tag === 'GOLDEN' ? 'cycle-card-golden' : ''}">
      <div class="cycle-card-header">
        <span class="badge ${item.badgeClass}">${item.tag}</span>
        <span class="cycle-hours">${item.totalHours} Jam Tidur (${item.cycles} Siklus)</span>
      </div>
      <div class="cycle-time-row">
        <span class="cycle-time">${item.waketime}</span>
        <button class="btn-alarm-set" onclick="setAlarmTime('${item.waketime.split(':')[0]}', '${item.waketime.split(':')[1]}', 'Bangun ${item.cycles} Siklus (${item.waketime})')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          Pasang Alarm Bangun
        </button>
      </div>
      <p class="cycle-desc">${item.desc}</p>
    </div>
  `).join('');
}

function renderQailullahZone() {
  const zone = getQailullahZone();
  const badge = document.getElementById('qailullah-live-zone-badge');
  const desc = document.getElementById('qailullah-live-zone-desc');

  if (badge) {
    badge.className = `badge ${zone.badgeClass}`;
    badge.textContent = zone.label;
  }
  if (desc) {
    desc.textContent = zone.desc;
  }
}

function renderStreak() {
  const countEl = document.getElementById('streak-count-display');
  const rankEl = document.getElementById('streak-rank-display');
  const checkInBtn = document.getElementById('btn-subuh-checkin');

  if (!countEl || !rankEl) return;

  const streak = AppState.streak.count;
  countEl.textContent = `${streak} Hari`;

  let rank = '🛌 Pejuang Kasur';
  if (streak >= 31) rank = '👑 Sultan Fajar / Syamsul Fajar';
  else if (streak >= 15) rank = '⚔️ Ksatria Fajar';
  else if (streak >= 8) rank = '🛡️ Penjaga Shubuh';
  else if (streak >= 4) rank = '🌅 Pencari Fajar';

  rankEl.textContent = rank;

  // Check in status today
  const todayStr = new Date().toISOString().slice(0, 10);
  if (AppState.streak.lastCheckInDate === todayStr) {
    checkInBtn.disabled = true;
    checkInBtn.textContent = '✓ Subuh Hari Ini Sudah Dicatat!';
    checkInBtn.className = 'btn-subuh-done';
  } else {
    checkInBtn.disabled = false;
    checkInBtn.textContent = 'Catat Bangun Subuh Hari Ini (+1 Streak)';
    checkInBtn.className = 'btn-emerald';
  }

  // Quick wins checkboxes
  renderQuickWins();
}

function checkInSubuh() {
  const tzNow = getNowInTZ(AppState.settings.tzOffset);
  const todayStr = getDateStrInTZ(tzNow);
  if (AppState.streak.lastCheckInDate === todayStr) return;

  // Check if consecutive yesterday
  const yesterday = new Date(tzNow.getTime() - 86400000);
  const yestStr = getDateStrInTZ(yesterday);

  if (AppState.streak.lastCheckInDate === yestStr) {
    AppState.streak.count += 1;
  } else {
    AppState.streak.count = 1; // reset or start
  }

  AppState.streak.lastCheckInDate = todayStr;
  AppState.streak.history.push({ date: todayStr, timestamp: Date.now() });

  saveState(AppState);
  renderStreak();
  triggerToast('Alhamdulillah! Streak Subuh bertambah! Pertahankan istiqomah.');
}

function renderQuickWins() {
  const tzNow = getNowInTZ(AppState.settings.tzOffset);
  const todayStr = getDateStrInTZ(tzNow);
  if (AppState.quickWins.date !== todayStr) {
    // Reset daily
    AppState.quickWins = {
      date: todayStr,
      dzikir: false,
      water: false,
      sunlight: false,
      stretch: false
    };
    saveState(AppState);
  }

  ['dzikir', 'water', 'sunlight', 'stretch'].forEach(key => {
    const el = document.getElementById(`quickwin-${key}`);
    if (el) el.checked = AppState.quickWins[key];
  });
}

function toggleQuickWin(key) {
  AppState.quickWins[key] = !AppState.quickWins[key];
  saveState(AppState);
  renderQuickWins();
}

function renderActiveAlarmBanner() {
  const banner = document.getElementById('active-alarm-banner');
  const text = document.getElementById('active-alarm-text');

  if (!banner) return;

  if (AppState.activeAlarm) {
    const now = Date.now();
    const diffMs = AppState.activeAlarm.timestamp - now;
    const tzLabel = getTimezoneLabel(AppState.settings.tzOffset);

    if (diffMs > 0) {
      const diffH = Math.floor(diffMs / (1000 * 60 * 60));
      const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      text.textContent = `Alarm Aktif: ${AppState.activeAlarm.time} ${tzLabel} • Berdering dalam ${diffH}j ${diffM}m lagi (${AppState.activeAlarm.label})`;
    } else {
      text.textContent = `Alarm Aktif: ${AppState.activeAlarm.time} ${tzLabel} • Waktunya bangun!`;
    }
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function showAlarmModal(alarmObj) {
  const modal = document.getElementById('alarm-ring-modal');
  const title = document.getElementById('alarm-ring-title');
  const desc = document.getElementById('alarm-ring-desc');

  if (modal) {
    if (title) title.textContent = 'WAKTU BANGUN TELAH TIBA!';
    if (desc) desc.textContent = alarmObj.label || 'Siklus tidur selesai. Bangun segar tanpa rasa pening!';
    modal.classList.add('active');
  }
}

function hideAlarmModal() {
  const modal = document.getElementById('alarm-ring-modal');
  if (modal) modal.classList.remove('active');
}

function triggerToast(msg) {
  const toast = document.getElementById('global-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ==========================================
// 10. AUDIT & JOURNAL ACTIONS
// ==========================================
function renderAuditQuestions() {
  const container = document.getElementById('audit-questions-container');
  if (!container) return;

  container.innerHTML = AUDIT_QUESTIONS.map((q, idx) => `
    <div class="audit-question-card" id="audit-q-card-${q.id}">
      <div class="audit-q-num">Pertanyaan ${idx + 1} dari ${AUDIT_QUESTIONS.length}</div>
      <h3 class="audit-q-title">${q.title}</h3>
      <p class="audit-q-desc">${q.desc}</p>
      <div class="audit-options-list">
        ${q.options.map((opt, optIdx) => `
          <label class="audit-option-label">
            <input type="radio" name="audit_q_${q.id}" value="${opt.score}" required onchange="onAuditAnswerChange()">
            <span class="audit-option-text">${opt.text}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function onAuditAnswerChange() {
  const answeredCount = AUDIT_QUESTIONS.filter(q => {
    return document.querySelector(`input[name="audit_q_${q.id}"]:checked`);
  }).length;

  const btn = document.getElementById('btn-submit-audit');
  if (btn) {
    btn.textContent = `Hitung Rapor Tidur (${answeredCount}/${AUDIT_QUESTIONS.length})`;
    btn.disabled = answeredCount < AUDIT_QUESTIONS.length;
  }
}

function submitAudit() {
  const scores = AUDIT_QUESTIONS.map(q => {
    const checked = document.querySelector(`input[name="audit_q_${q.id}"]:checked`);
    return checked ? parseInt(checked.value) : 0;
  });

  const result = scoreAudit(scores);
  AppState.auditResult = result;
  saveState(AppState);
  renderAuditResult(result);
  triggerToast('Rapor Kesehatan Tidur Anda Berhasil Dihitung!');
}

function renderAuditResult(res) {
  const container = document.getElementById('audit-result-view');
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = `
    <div class="audit-result-card">
      <div class="audit-grade-circle ${res.badgeClass}">
        <span class="audit-grade-letter">${res.grade}</span>
        <span class="audit-score-num">${res.total} / 100</span>
      </div>
      <div class="audit-res-header">
        <h2 class="audit-res-title">${res.title}</h2>
        <p class="audit-res-diag">${res.diagnosis}</p>
      </div>
    </div>

    <div class="audit-protocol-box">
      <h3 class="protocol-heading">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        Protokol Pemulihan & Optimalisasi 7 Hari
      </h3>
      <ul class="protocol-list">
        ${res.recoveryProtocol.map(step => `<li>${step}</li>`).join('')}
      </ul>
    </div>
  `;
  container.scrollIntoView({ behavior: 'smooth' });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function saveJournalEntry() {
  const worryEl = document.getElementById('journal-worry-dump');
  const gratitudeEl = document.getElementById('journal-gratitude-list');

  const worry = worryEl ? worryEl.value.trim() : '';
  const gratitude = gratitudeEl ? gratitudeEl.value.trim() : '';

  if (!worry && !gratitude) {
    triggerToast('Tuliskan setidaknya satu refleksi atau uneg-uneg.');
    return;
  }

  const entry = {
    id: Date.now(),
    dateStr: new Date().toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    worry: escapeHTML(worry),
    gratitude: escapeHTML(gratitude)
  };

  AppState.journalEntries.unshift(entry);
  if (AppState.journalEntries.length > 30) AppState.journalEntries.pop(); // limit 30
  saveState(AppState);

  if (worryEl) worryEl.value = '';
  if (gratitudeEl) gratitudeEl.value = '';

  renderJournalHistory();
  triggerToast('Jurnal malam tersimpan. Beban pikiran terlepaskan.');
}

function renderJournalHistory() {
  const container = document.getElementById('journal-history-list');
  if (!container) return;

  if (!AppState.journalEntries || AppState.journalEntries.length === 0) {
    container.innerHTML = `<div class="empty-state">Belum ada catatan muhasabah. Tuliskan beban pikiran Anda sebelum tidur agar otak tenang.</div>`;
    return;
  }

  container.innerHTML = AppState.journalEntries.map(e => `
    <div class="journal-entry-card">
      <div class="journal-entry-date">${e.dateStr}</div>
      ${e.worry ? `<div class="journal-sec"><strong>Beban Pikiran (Pelepasan):</strong><p>${e.worry}</p></div>` : ''}
      ${e.gratitude ? `<div class="journal-sec"><strong>Rasa Syukur:</strong><p>${e.gratitude}</p></div>` : ''}
    </div>
  `).join('');
}

// ==========================================
// 11. ENSIKLOPEDIA SAINS TABS
// ==========================================
function switchArticleTab(artId) {
  document.querySelectorAll('.article-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.article-content').forEach(c => c.classList.remove('active'));

  const btn = document.getElementById(`art-btn-${artId}`);
  const content = document.getElementById(`art-content-${artId}`);

  if (btn) btn.classList.add('active');
  if (content) content.classList.add('active');
}

// ==========================================
// 12. INITIALIZATION ON DOM READY
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Setup clock & prayers
  renderClockAndPrayers();
  setInterval(renderClockAndPrayers, 1000);

  // Setup tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Setup Calculator Events
  const wakeInput = document.getElementById('calc-target-wake');
  const latencySlider = document.getElementById('calc-latency-slider');
  if (wakeInput) wakeInput.addEventListener('change', renderCalculatorBedtimes);
  if (latencySlider) {
    latencySlider.addEventListener('input', () => {
      renderCalculatorBedtimes();
      renderCalculatorWakeTimes();
    });
  }

  // Setup Qailullah buttons
  document.querySelectorAll('.btn-duration-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-duration-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const min = parseInt(btn.getAttribute('data-minutes'));
      setQailullahDuration(min);
    });
  });

  const playBtn = document.getElementById('qailullah-play-btn');
  const resetBtn = document.getElementById('qailullah-reset-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (qailullahRunning) pauseQailullah();
      else startQailullah();
    });
  }
  if (resetBtn) resetBtn.addEventListener('click', resetQailullah);

  // Subuh checkin
  const checkinBtn = document.getElementById('btn-subuh-checkin');
  if (checkinBtn) checkinBtn.addEventListener('click', checkInSubuh);

  // Sound test button
  const soundTestBtn = document.getElementById('btn-test-sound');
  if (soundTestBtn) {
    soundTestBtn.addEventListener('click', () => {
      if (AudioEngine.isPlaying) {
        AudioEngine.stop();
        soundTestBtn.textContent = 'Uji Suara Alarm';
      } else {
        AudioEngine.playProfile(AppState.settings.soundProfile, AppState.settings.volume);
        soundTestBtn.textContent = 'Hentikan Uji Suara';
      }
    });
  }

  // Settings profile change
  const profileSelect = document.getElementById('settings-sound-profile');
  if (profileSelect) {
    profileSelect.value = AppState.settings.soundProfile;
    profileSelect.addEventListener('change', (e) => {
      AppState.settings.soundProfile = e.target.value;
      saveState(AppState);
    });
  }

  // Initial renders
  renderCalculatorBedtimes();
  renderCalculatorWakeTimes();
  renderQailullahZone();
  updateQailullahUI();
  renderStreak();
  renderActiveAlarmBanner();
  renderAuditQuestions();
  if (AppState.auditResult) renderAuditResult(AppState.auditResult);
  renderJournalHistory();

  // Alarm Watcher
  initAlarmWatcher();

  // Register Service Worker for offline PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => {
      console.log('X-BEGADANG Service Worker Registered.');
    }).catch(err => {
      console.warn('Service Worker registration skipped:', err);
    });
  }
});
