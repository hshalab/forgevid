@echo off
REM Fires the daily finance-reconciliation endpoint (appends one dated,
REM hash-linked P&L snapshot per UTC day to the evidence chain). Fallback
REM scheduler while GitHub Actions is unavailable (org billing lock); once
REM Actions is restored, .github/workflows/finance-reconciliation.yml does
REM the same job daily and this task can be deleted. Double-firing is
REM harmless — the endpoint is idempotent per UTC day.
REM
REM Register with Task Scheduler (daily, e.g. 23:30):
REM   schtasks /Create /SC DAILY /ST 23:30 /TN ForgeVidFinanceCron /TR "C:\Users\yanp0\dev\forgevid\scripts\finance-cron.cmd"
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
  echo [%date% %time%] ERROR: CRON_SECRET not found in .env.local >> marketing-out\finance-cron.log
  exit /b 1
)

for /f %%c in ('curl -s -o nul -w "%%{http_code}" -X POST "https://www.forgevid.com/api/cron/finance-reconciliation" -H "Authorization: Bearer %CRON_SECRET%"') do set "HTTP_CODE=%%c"
echo [%date% %time%] HTTP %HTTP_CODE% >> marketing-out\finance-cron.log
if not "%HTTP_CODE%"=="200" exit /b 1
