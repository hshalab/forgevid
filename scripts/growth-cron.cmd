@echo off
REM Daily growth ops: renders the day's 10 personalized prospect samples and
REM emails the operator the [PROSPECT] clips + one digest (batch list +
REM follow-ups due). The human reviews and sends — nothing here contacts a
REM prospect (see scripts/growth-daily.ts COMPLIANCE note).
REM
REM Register with Task Scheduler (daily, e.g. 06:30 so the inbox is ready
REM by morning; renders take ~10-30 min):
REM   schtasks /Create /SC DAILY /ST 06:30 /TN "ForgeVid Growth Ops" /TR "C:\Users\yanp0\dev\forgevid\scripts\growth-cron.cmd"
setlocal
cd /d C:\Users\yanp0\dev\forgevid

call npx tsx scripts/growth-daily.ts >> marketing-out\growth-daily.log 2>&1
