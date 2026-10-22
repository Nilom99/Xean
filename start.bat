@echo off
REM Codex Local - one-click launcher for Windows (no VS Code required).
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [codex-local] ERROR: Node.js 20+ is required but was not found on PATH.
  echo [codex-local] Install it from https://nodejs.org and re-run this file.
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo [codex-local] ERROR: Node.js 20+ is required.
  exit /b 1
)

if not exist node_modules (
  echo [codex-local] Installing dependencies ^(this only happens once^)...
  call npm install
  if errorlevel 1 (
    echo [codex-local] ERROR: npm install failed.
    exit /b 1
  )
)

echo [codex-local] Building and launching Codex Local...
if "%~1"=="--dev" (
  call npm run dev
) else (
  call npm run start
)

endlocal
