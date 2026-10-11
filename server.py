"""
X-BEGADANG Standalone Server
Zero-Defect FastAPI Server serving X-BEGADANG PWA on port 8780.
Binds to 0.0.0.0 so Boss Dingga can access it seamlessly on Android mobile & PC.
"""
import os
import socket
import datetime
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from test_core import calculate_prayer_times, calculate_bedtimes, calculate_wake_times, get_qailullah_zone, evaluate_sleep_audit

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(
    title="X-BEGADANG",
    description="Neuro-Sleep Architecture & Sunnah Wake Engine API",
    version="1.0.0"
)

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

@app.get("/")
async def get_index():
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    raise HTTPException(status_code=404, detail="index.html not found")

@app.get("/manifest.json")
async def get_manifest():
    manifest_path = os.path.join(BASE_DIR, "manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/manifest+json")
    raise HTTPException(status_code=404, detail="manifest.json not found")

@app.get("/sw.js")
async def get_service_worker():
    sw_path = os.path.join(BASE_DIR, "sw.js")
    if os.path.exists(sw_path):
        return FileResponse(sw_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="sw.js not found")

@app.get("/api/info")
async def get_info():
    local_ip = get_local_ip()
    return {
        "app": "X-BEGADANG",
        "version": "1.0.0",
        "status": "ONLINE",
        "local_ip": local_ip,
        "port": 8780,
        "access_urls": {
            "pc_local": "http://127.0.0.1:8780",
            "android_mobile": f"http://{local_ip}:8780"
        },
        "timestamp": datetime.datetime.now().isoformat()
    }

@app.get("/api/prayer-times")
async def api_prayer_times(lat: float = -6.2088, lon: float = 106.8456, tz: float = 7.0):
    return calculate_prayer_times(lat, lon, tz)

@app.get("/api/cycles/bedtimes")
async def api_bedtimes(wake_time: str = "04:30", latency: int = 14):
    return calculate_bedtimes(wake_time, latency)

@app.get("/api/cycles/waketimes")
async def api_waketimes(latency: int = 14):
    return calculate_wake_times(latency_min=latency)

@app.get("/api/qailullah/status")
async def api_qailullah():
    now = datetime.datetime.now()
    h = now.hour + now.minute / 60.0
    return get_qailullah_zone(h)

# Mount remaining static assets (icons, css, js)
app.mount("/", StaticFiles(directory=BASE_DIR), name="static")

if __name__ == "__main__":
    local_ip = get_local_ip()
    print("=" * 65)
    print("  🚀 X-BEGADANG SERVER BERJALAN")
    print(f"  • Akses PC (Browser)     : http://127.0.0.1:8780")
    print(f"  • Akses Android (Wi-Fi)  : http://{local_ip}:8780")
    print("=" * 65)
    uvicorn.run(app, host="0.0.0.0", port=8780, log_level="info")
