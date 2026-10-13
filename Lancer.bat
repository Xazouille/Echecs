@echo off
title Coup par Coup
cd /d "%~dp0"

if not exist "%~dp0server.ps1" goto incomplet
if not exist "%~dp0docs\index.html" goto incomplet

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
echo.
echo  Le serveur s'est arrete. Si un message d'erreur s'affiche au-dessus,
echo  copie-le pour le diagnostic.
pause
exit /b

:incomplet
echo.
echo  Il manque des fichiers a cote de Lancer.bat (server.ps1 ou le dossier docs).
echo.
echo  Si tu as telecharge le dossier depuis Google Drive, c'est un fichier .zip :
echo    1. Ferme cette fenetre.
echo    2. Clic droit sur le .zip, puis "Extraire tout...".
echo    3. Ouvre le dossier extrait et double-clique sur Lancer.bat.
echo.
echo  Dossier actuel : %~dp0
echo.
pause
exit /b 1
