@echo off
REM Fires the scheduled-inventory-import endpoint. Fallback scheduler while
REM GitHub Actions is unavailable (org billing lock); once Actions is
REM restored, .github/workflows/inventory-cron.yml does the same job hourly
REM and this task can be deleted. Double-firing is harmless — the endpoint
REM claims each due source atomically.
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
  echo [%date% %time%] ERROR: CRON_SECRET not found in .env.local >> marketing-out\inventory-cron.log
  exit /b 1
)

for /f %%c in ('curl -s -o nul -w "%%{http_code}" -X POST "https://www.forgevid.com/api/cron/inventory-sources" -H "Authorization: Bearer %CRON_SECRET%"') do set "HTTP_CODE=%%c"
echo [%date% %time%] HTTP %HTTP_CODE% >> marketing-out\inventory-cron.log
if not "%HTTP_CODE%"=="200" exit /b 1
