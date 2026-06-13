@echo off
title Iniciar Dashboard - Maestria
chcp 65001 > nul

echo ==========================================================
echo    INICIALIZADOR AUTOMÁTICO DEL DASHBOARD DE PRODUCTOS
echo ==========================================================
echo.

:: 1. Verificar si Node.js está disponible en el entorno
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js no está instalado en este equipo.
    echo [i] Descargando la versión portátil (LTS) para evitar requerir permisos de administrador...
    
    :: Crear directorio temporal
    mkdir .node_temp >nul 2>nul
    
    :: Descargar paquete zip oficial de Node.js usando PowerShell
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile '.node_temp\node.zip'"
    if %errorlevel% neq 0 (
        echo [ERROR] No se pudo descargar Node.js. Por favor, verifica tu conexión a internet.
        pause
        exit /b
    )
    
    echo [i] Descomprimiendo Node.js portátil (esto puede tomar unos segundos)...
    powershell -Command "Expand-Archive -Path '.node_temp\node.zip' -DestinationPath '.node_temp'"
    
    :: Mover la carpeta extraída a una ubicación definitiva local
    move .node_temp\node-v20.11.1-win-x64 .node_local >nul 2>nul
    
    :: Eliminar residuos temporales
    rmdir /s /q .node_temp >nul 2>nul
    
    :: Modificar temporalmente el PATH de esta sesión de consola para usar el Node local
    set "PATH=%~dp0.node_local;%PATH%"
    echo [OK] Node.js portátil configurado localmente en esta sesión.
    echo.
) else (
    echo [OK] Node.js ya está instalado a nivel global.
    echo.
)

:: 2. Instalar dependencias del proyecto (Express) si no existen
if not exist node_modules (
    echo [i] Carpeta node_modules no encontrada. Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Falló la instalación de las dependencias.
        pause
        exit /b
    )
    echo [OK] Dependencias instaladas correctamente.
    echo.
) else (
    echo [OK] Las dependencias ya están instaladas.
    echo.
)

:: 3. Abrir automáticamente la URL en el navegador por defecto
echo [i] Abriendo el dashboard en tu navegador predeterminado...
start http://localhost:3000

:: 4. Arrancar el servidor Express de Node.js
echo [i] Iniciando servidor web local...
echo [i] Presioná CTRL+C en esta consola para apagar el servidor.
echo.
call npm start

pause
