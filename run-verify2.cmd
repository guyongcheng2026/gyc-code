@echo off
setlocal
cd /d "c:\Users\谷勇成\gyc-cli"
bun test src/gyccode/default-model.test.ts > verify-model2.log 2>&1
echo TEST_EXIT=%ERRORLEVEL% >> verify-model2.log
