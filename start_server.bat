@echo off
title HealthySure Local Web Server
echo Starting HealthySure Local Server on http://localhost:8080 ...
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
