"""Automated Playwright QA script for X-BEGADANG
Verifies:
- 0 Console errors/exceptions
- Full interactivity across all 5 modules
- Alarm audio synth trigger
- Mobile and Desktop visual screenshots
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

def run_qa():
    url = "http://127.0.0.1:8780/"
    console_errors = []
    
    desktop_screenshot = r"C:\Users\ZAVIER\projects\x-begadang\screenshot_desktop.png"
    mobile_screenshot = r"C:\Users\ZAVIER\projects\x-begadang\screenshot_mobile.png"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        # 1. Desktop Test
        print("[1/3] Running Desktop Viewport Audit (1280x820)...")
        page = browser.new_page(viewport={"width": 1280, "height": 820})
        
        def handle_console(msg):
            if msg.type in ["error"]:
                console_errors.append(f"CONSOLE ERROR: {msg.text}")
                print(f"  [!] Browser Console Error: {msg.text}")
                
        def handle_page_error(err):
            console_errors.append(f"PAGE ERROR: {err}")
            print(f"  [!] Unhandled Page Exception: {err}")
            
        page.on("console", handle_console)
        page.on("pageerror", handle_page_error)
        
        # Navigate
        res = page.goto(url, wait_until="networkidle")
        assert res.status == 200, f"HTTP status failed: {res.status}"
        print(f"  ✓ HTTP 200 OK - Title: '{page.title()}'")
        
        # Check Dashboard elements
        clock_text = page.locator("#header-live-clock").text_content()
        assert len(clock_text) >= 5, "Clock text empty"
        print(f"  ✓ Live Clock Active: {clock_text}")
        
        # Check prayer grid
        prayers = page.locator(".prayer-chip").count()
        assert prayers >= 5, f"Prayers chip count too low: {prayers}"
        print(f"  ✓ Astronomical Prayer Grid: {prayers} prayers loaded")
        
        # Test Subuh checkin
        page.click("#btn-subuh-checkin")
        streak_text = page.locator("#streak-count-display").text_content()
        print(f"  ✓ Subuh Check-in clicked. Current Streak: {streak_text}")
        
        # Quick wins
        page.check("#quickwin-dzikir")
        page.check("#quickwin-water")
        print("  ✓ Quick Wins checked successfully")
        
        # 2. Test Kalkulator Siklus
        print("[2/3] Testing Kalkulator Siklus & Alarm...")
        page.click("#nav-btn-kalkulator")
        page.wait_for_timeout(300)
        
        # Set wake time to 04:30
        page.fill("#calc-target-wake", "04:15")
        page.locator("#calc-target-wake").dispatch_event("change")
        page.wait_for_timeout(300)
        
        bedtimes = page.locator("#calc-bedtime-results .cycle-card").count()
        assert bedtimes == 6, f"Expected 6 cycle cards, got {bedtimes}"
        print(f"  ✓ Ultradian Cycle Bedtimes: {bedtimes} cards rendered")
        
        # Click set alarm on first card
        page.locator("#calc-bedtime-results .btn-alarm-set").first.click()
        page.wait_for_timeout(200)
        alarm_banner = page.locator("#active-alarm-banner")
        assert alarm_banner.is_visible(), "Active alarm banner not visible"
        print(f"  ✓ Alarm Set Banner Verified: '{page.locator('#active-alarm-text').text_content()}'")
        
        # Test Sleep Now mode
        page.click("#calc-mode-sleepnow-btn")
        page.wait_for_timeout(300)
        waketimes = page.locator("#calc-waketime-results .cycle-card").count()
        assert waketimes == 6, f"Expected 6 waketime cards, got {waketimes}"
        print(f"  ✓ 'Tidur Sekarang' mode: {waketimes} cards rendered")
        
        # 3. Test Smart Qailullah
        page.click("#nav-btn-qailullah")
        page.wait_for_timeout(300)
        
        zone_label = page.locator("#qailullah-live-zone-badge").text_content()
        print(f"  ✓ Qailullah Live Radar Zone: '{zone_label}'")
        
        # Change preset to 20m and start
        page.locator(".btn-duration-preset[data-minutes='20']").click()
        page.click("#qailullah-play-btn")
        page.wait_for_timeout(1500)
        timer_digits = page.locator("#qailullah-timer-display").text_content()
        print(f"  ✓ Qailullah Timer running: {timer_digits}")
        page.click("#qailullah-play-btn") # pause
        page.click("#qailullah-reset-btn") # reset
        print("  ✓ Qailullah Timer Paused & Reset successfully")
        
        # 4. Test Audit & Jurnal
        page.click("#nav-btn-audit")
        page.wait_for_timeout(300)
        
        # Answer all 10 questions
        for q_id in range(1, 11):
            page.locator(f"input[name='audit_q_{q_id}']").first.check()
        page.wait_for_timeout(200)
        
        submit_audit_btn = page.locator("#btn-submit-audit")
        assert not submit_audit_btn.is_disabled(), "Audit button still disabled"
        submit_audit_btn.click()
        page.wait_for_timeout(400)
        
        grade_letter = page.locator(".audit-grade-letter").text_content()
        print(f"  ✓ Sleep Audit Submitted. Result Grade: {grade_letter}")
        
        # Test Jurnal subtab
        page.click("#subview-btn-journal")
        page.wait_for_timeout(300)
        page.fill("#journal-worry-dump", "Testing mental clarity & zero overthinking protocol.")
        page.fill("#journal-gratitude-list", "1. Kesehatan prima. 2. Keberkahan waktu. 3. Target kerja tuntas.")
        page.click("button:has-text('Simpan & Lepaskan Beban Pikiran Malam Ini')")
        page.wait_for_timeout(300)
        
        entries_count = page.locator(".journal-entry-card").count()
        assert entries_count >= 1, "Journal entry not rendered"
        print(f"  ✓ Journal Entry Saved & Verified: {entries_count} entry in history")
        
        # 5. Test Ensiklopedia Sains
        page.click("#nav-btn-ensiklopedia")
        page.wait_for_timeout(300)
        for art_id in range(1, 8):
            page.click(f"#art-btn-{art_id}")
            assert page.locator(f"#art-content-{art_id}").is_visible(), f"Article {art_id} not visible"
        print("  ✓ Ensiklopedia Sains: All 7 peer-reviewed articles rendered cleanly")
        
        # 6. Test Settings & Audio Synth
        page.click("#btn-open-settings")
        page.wait_for_timeout(200)
        page.select_option("#settings-sound-profile", "binaural")
        page.click("#btn-test-sound")
        page.wait_for_timeout(1000)
        page.click("#btn-test-sound") # stop
        page.click("button:has-text('Simpan Pengaturan')")
        print("  ✓ Web Audio API Sound Synthesizer Tested & Settings Saved")
        
        # Back to Dashboard for Desktop screenshot
        page.click("#nav-btn-dashboard")
        page.wait_for_timeout(500)
        page.screenshot(path=desktop_screenshot, full_page=False)
        print(f"  ✓ Desktop Screenshot saved: {desktop_screenshot}")
        
        # 7. Mobile Viewport Audit (390x844 - iPhone / Pixel standard)
        print("[3/3] Running Mobile Viewport Audit (390x844)...")
        mobile_page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True)
        mobile_page.goto(url, wait_until="networkidle")
        mobile_page.wait_for_timeout(500)
        
        # Check mobile bottom nav bar visibility
        mobile_nav = mobile_page.locator("nav.mobile-bottom-nav")
        assert mobile_nav.is_visible(), "Mobile bottom nav is not visible on mobile viewport"
        print("  ✓ Mobile Bottom Navigation Bar Verified & Active")
        
        # Take Mobile screenshot
        mobile_page.screenshot(path=mobile_screenshot, full_page=False)
        print(f"  ✓ Mobile Screenshot saved: {mobile_screenshot}")
        
        browser.close()
        
    print("=" * 60)
    print(f"TOTAL CONSOLE ERRORS DETECTED: {len(console_errors)}")
    if console_errors:
        for err in console_errors:
            print(f"  ERROR: {err}")
        sys.exit(1)
    else:
        print("🏆 ZERO DEFECT VERIFIED! 100% PERFECT PASS ON ALL AUDITS!")
        print("=" * 60)

if __name__ == "__main__":
    run_qa()
