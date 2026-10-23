@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)
if not exist data\beco105.db (
  echo.
  echo Primeira vez: vamos criar o seu usuario da gerencia.
  set /p USUARIO=Nome de usuario: 
  set /p SENHA=Senha (8 ou mais caracteres): 
  call node --no-warnings scripts\usuario.js "%USUARIO%" "%SENHA%"
)
echo.
echo Mural no ar. TV: http://localhost:3000/tv   Gestao: http://localhost:3000/gestao
echo Deixe esta janela aberta enquanto o bar funciona.
node --no-warnings server.js
pause
