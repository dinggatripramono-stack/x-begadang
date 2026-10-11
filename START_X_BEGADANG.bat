@echo off
title X-BEGADANG - Standalone Neuro-Sleep Architecture
cd /d "%~dp0"
cls
echo ======================================================================
echo    X-BEGADANG : Neuro-Sleep Architecture ^& Sunnah Wake Engine
echo    Standar Kualitas Dunia AAA - Zero-Defect Paripurna
echo ======================================================================
echo.

:: Get Local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" /c:"Alamat IPv4"') do (
    set "LOCAL_IP=%%a"
    goto :ip_found
)
set "LOCAL_IP= 127.0.0.1"
:ip_found
set "LOCAL_IP=%LOCAL_IP: =%"

echo  [*] Menyiapkan Server X-BEGADANG pada Port 8780...
echo  [*] URL Akses PC      : http://127.0.0.1:8780
echo  [*] URL Akses Android : http://%LOCAL_IP%:8780
echo.
echo  [*] Membuka X-BEGADANG di browser...
start "" "http://127.0.0.1:8780"

echo.
echo  [*] Server berjalan aktif di latar belakang (Tutup jendela ini jika ingin stop).
echo ======================================================================
python server.py
pause
