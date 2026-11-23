@echo off
title HealthySure BD Central Repository - Public Shareable Link
cd /d "%~dp0"
echo ============================================================
echo   Starting HealthySure BD Central Repository Public Tunnel
echo ============================================================
echo.
echo 1. Ensuring local server is running...
start /b powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
timeout /t 2 /nobreak >nul

echo 2. Launching Cloudflare HTTPS Public Tunnel...
echo.
echo ============================================================
echo   LOOK BELOW FOR YOUR SHAREABLE HTTPS LINK (trycloudflare.com)
echo ============================================================
echo.
"C:\Users\Admin\.gemini\antigravity\tools\cloudflared.exe" tunnel --http-host-header "localhost" --url http://localhost:8080
pause
