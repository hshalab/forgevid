@echo off
REM Fires the canary-guard endpoint (metric-triggered automatic rollback for
REM optimization canaries). Fallback scheduler while GitHub Actions is
REM unavailable (org billing lock); once Actions is restored,
REM .github/workflows/canary-guard.yml does the same job every 6 hours and
REM this task can be deleted. Re-firing is harmless — the endpoint is a
REM cheap no-op when no canaries are live.
REM
REM Register with Task Scheduler (every 6 hours):
REM   schtasks /Create /SC HOURLY /MO 6 /TN ForgeVidCanaryGuard /TR "C:\Users\yanp0\dev\forgevid\scripts\canary-cron.cmd"
REM
REM The secret lives in .env.local (gitignored), never in this file: the
REM repo is public.
setlocal enabledelayedexpansion
cd /d C:\Users\yanp0\dev\forgevid

set "CRON_SECRET="
for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
  if "%%a"=="CRON_SECRET" set "CRON_SECRET=%%b"
)
if "%CRON_SECRET%"=="" (
  echo [%date% %time%] ERROR: CRON_SECRET not found in .env.local >> marketing-out\canary-cron.log
  exit /b 1
)

for /f %%c in ('curl -s -o nul -w "%%{http_code}" -X POST "https://www.forgevid.com/api/cron/canary-guard" -H "Authorization: Bearer %CRON_SECRET%"') do set "HTTP_CODE=%%c"
echo [%date% %time%] HTTP %HTTP_CODE% >> marketing-out\canary-cron.log
if not "%HTTP_CODE%"=="200" exit /b 1
