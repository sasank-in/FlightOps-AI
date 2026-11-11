@echo off
setlocal EnableExtensions
rem ===========================================================================
rem  FlightOps AI - stop the services started by start.bat
rem  Stops ONLY FlightOps processes, matched by their exact command line:
rem    inference API   uvicorn app.main:app --app-dir services/inference-api
rem    backend         java -jar ...\application-backend-*.jar
rem    dashboard       vite (dev or preview) inside frontend\dashboard
rem  Other programs (pgAdmin, IDEs, other Java/Python apps) are never touched.
rem ===========================================================================

echo.
echo  FlightOps AI - stopping services
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$rules = @(" ^
  "  @{ Name = 'Inference API'; Match = { $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'services[\\/]inference-api' } }," ^
  "  @{ Name = 'Backend';       Match = { $_.CommandLine -match 'application-backend-[\d.]+\.jar' } }," ^
  "  @{ Name = 'Dashboard';     Match = { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite' -and $_.CommandLine -match 'frontend[\\/]dashboard' } }" ^
  ");" ^
  "$all = Get-CimInstance Win32_Process;" ^
  "foreach ($r in $rules) {" ^
  "  $procs = @($all | Where-Object $r.Match);" ^
  "  if ($procs.Count -eq 0) { Write-Host ('  [--] ' + $r.Name + ': not running'); continue }" ^
  "  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('  [ok] ' + $r.Name + ' stopped (PID ' + $p.ProcessId + ')') }" ^
  "}"
echo  Done. The service windows show the process exit and can be closed.
echo.
endlocal & exit /b 0
