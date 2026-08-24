@echo off
setlocal

cd /d "%~dp0"

if not exist "%~dp0node_modules\express" (
  echo No se encontraron las dependencias. Ejecutando npm install...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

if not exist "%~dp0.env" (
  if exist "%~dp0.env.example" (
    echo Creando .env desde .env.example...
    copy /Y "%~dp0.env.example" "%~dp0.env" >nul
  ) else (
    echo No se encontro .env.example. El servidor continuara sin configuracion local.
  )
)

start "Servidor Test de Turing" /D "%~dp0" cmd.exe /k npm start
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000/operador"

endlocal
