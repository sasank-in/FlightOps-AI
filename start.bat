@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ===========================================================================
rem  FlightOps AI - start the backend services
rem    1. Inference API  (FastAPI, conda env "environ")   http://127.0.0.1:8000
rem    2. Backend        (Spring Boot, Java 21)           http://127.0.0.1:8080
rem  Each service runs in its own window; close a window (or run stop.bat) to stop it.
rem
rem  Usage:  start.bat              backend services only
rem          start.bat dashboard    also start the dashboard (http://127.0.0.1:5173)
rem          start.bat build        rebuild the backend jar first, then start
rem ===========================================================================

cd /d "%~dp0"
set "ROOT=%CD%"
set "JAR=%ROOT%\services\application-backend\target\application-backend-0.1.0.jar"
set "WITH_DASHBOARD=0"
set "FORCE_BUILD=0"
for %%A in (%*) do (
  if /i "%%~A"=="dashboard" set "WITH_DASHBOARD=1"
  if /i "%%~A"=="build" set "FORCE_BUILD=1"
)

echo.
echo  FlightOps AI - starting backend services
echo  ----------------------------------------

rem --- prerequisites ---------------------------------------------------------
if not exist "%ROOT%\.env" (
  echo  [error] .env not found in %ROOT%
  echo          Copy .env.example to .env and fill in DATABASE_URL, FLIGHTOPS_JWT_SECRET, FLIGHTOPS_ADMIN_PASSWORD.
  goto :fail
)

rem Python of the conda env "environ" (override with FLIGHTOPS_PYTHON=path\to\python.exe)
set "PY=%FLIGHTOPS_PYTHON%"
if not defined PY if defined CONDA_PREFIX if exist "%CONDA_PREFIX%\..\..\envs\environ\python.exe" set "PY=%CONDA_PREFIX%\..\..\envs\environ\python.exe"
if not defined PY if exist "%USERPROFILE%\miniconda3\envs\environ\python.exe" set "PY=%USERPROFILE%\miniconda3\envs\environ\python.exe"
if not defined PY if exist "%USERPROFILE%\anaconda3\envs\environ\python.exe" set "PY=%USERPROFILE%\anaconda3\envs\environ\python.exe"
if not defined PY (
  echo  [error] Python of conda env "environ" not found. Set FLIGHTOPS_PYTHON to its python.exe.
  goto :fail
)
rem Keep packages in %%APPDATA%%\Python out of the env (a broken ipykernel lives there).
set "PYTHONNOUSERSITE=1"

where java >nul 2>nul || (echo  [error] Java not found on PATH ^(Java 21 required^). & goto :fail)
where curl >nul 2>nul || (echo  [error] curl not found on PATH. & goto :fail)

if not exist "%ROOT%\artifacts\models\if_tail_hybrid_v0.4.0.joblib" (
  echo  [error] Model artifact missing: artifacts\models\if_tail_hybrid_v0.4.0.joblib
  echo          Train it with:  "%PY%" -m flightops.models.train_hybrid
  goto :fail
)

rem --- backend jar -----------------------------------------------------------
if "%FORCE_BUILD%"=="1" goto :build
if not exist "%JAR%" goto :build
goto :ports
:build
where mvn >nul 2>nul || (echo  [error] Maven not found on PATH; cannot build the backend jar. & goto :fail)
echo  Building backend jar (mvn package, tests skipped) ...
pushd "%ROOT%\services\application-backend"
call mvn -q -B -DskipTests package
set "MVN_EXIT=!ERRORLEVEL!"
popd
if not "!MVN_EXIT!"=="0" (echo  [error] Maven build failed. & goto :fail)
echo  [ok] backend jar built

rem --- ports -----------------------------------------------------------------
:ports
call :port_free 8000 "Inference API" || goto :fail
call :port_free 8080 "Backend" || goto :fail
if "%WITH_DASHBOARD%"=="1" (call :port_free 5173 "Dashboard" || goto :fail)

rem --- 1. inference API --------------------------------------------------------
echo  Starting inference API on :8000 ...
start "FlightOps - Inference API :8000" /D "%ROOT%" cmd /k ""%PY%" -m uvicorn app.main:app --app-dir services/inference-api --host 127.0.0.1 --port 8000"
call :wait_for "http://127.0.0.1:8000/health" "\"model_loaded\":true" 90 "Inference API" || goto :fail

rem --- 2. Spring Boot backend --------------------------------------------------
rem Run from the module folder: the backend reads the repo-root .env as ../../.env
echo  Starting backend on :8080 ...
start "FlightOps - Backend :8080" /D "%ROOT%\services\application-backend" cmd /k "java -jar "%JAR%""
call :wait_for "http://127.0.0.1:8080/actuator/health" "\"status\":\"UP\"" 120 "Backend" || goto :fail

rem --- 3. optional dashboard ---------------------------------------------------
if "%WITH_DASHBOARD%"=="1" (
  where npm >nul 2>nul || (echo  [error] npm not found on PATH. & goto :fail)
  if not exist "%ROOT%\frontend\dashboard\node_modules" (
    echo  Installing dashboard dependencies ^(npm ci^) ...
    pushd "%ROOT%\frontend\dashboard"
    call npm ci --no-fund --no-audit
    popd
  )
  echo  Starting dashboard on :5173 ...
  start "FlightOps - Dashboard :5173" /D "%ROOT%\frontend\dashboard" cmd /k "npm run dev"
  call :wait_for "http://127.0.0.1:5173/" "<div id=\"root\">" 60 "Dashboard" || goto :fail
)

echo.
echo  All services are running:
echo    Inference API   http://127.0.0.1:8000/docs
echo    Backend API     http://127.0.0.1:8080/api/v1   (health: /actuator/health)
if "%WITH_DASHBOARD%"=="1" (
  echo    Dashboard       http://127.0.0.1:5173   ^(sign in with FLIGHTOPS_ADMIN_USERNAME / _PASSWORD from .env^)
) else (
  echo    Dashboard       not started - run:  start.bat dashboard   or   cd frontend\dashboard ^&^& npm run dev
)
echo.
echo  Stop: close the service windows, or run stop.bat
echo.
endlocal & exit /b 0

rem ===========================================================================
:port_free
rem %1 = port, %2 = name.  Fails if anything answers HTTP on the port. "000" = nothing answered
rem (refused or no response); independent of netstat and of IPv4/IPv6 binding.
set "_code=000"
for /f %%C in ('curl -s -m 2 -o nul -w "%%{http_code}" "http://127.0.0.1:%~1/" 2^>nul') do set "_code=%%C"
if not "!_code!"=="000" (
  echo  [error] Port %~1 is already in use ^(%~2 may already be running, HTTP !_code!^). Run stop.bat first.
  exit /b 1
)
exit /b 0

:wait_for
rem %1 = url, %2 = text expected in the response, %3 = timeout seconds, %4 = name
set /a "_left=%~3"
:wait_loop
curl -s -m 3 "%~1" 2>nul | findstr /c:%2 >nul
if not errorlevel 1 (
  echo  [ok] %~4 is up
  exit /b 0
)
set /a "_left-=1"
if !_left! LEQ 0 (
  echo  [error] %~4 did not become healthy within %~3 s. Check its window for errors.
  exit /b 1
)
rem one-second pause that also works without an interactive console
ping -n 2 127.0.0.1 >nul
goto :wait_loop

:fail
echo.
echo  Start-up aborted.
endlocal & exit /b 1
