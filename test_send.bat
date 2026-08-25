@echo off
cd /d C:\gyc-code
"C:\Program Files\nodejs\node_modules\bun\bin\bun.exe" --preload ./scripts/bun-solid-preload.ts --conditions=browser ./src/gyccode/index.ts send --to weixin "测试修复" --json