@echo off
setlocal
cd /d "c:\Users\谷勇成\gyc-cli"
del verify-web.log verify-build.log 2>nul
git add -A
git commit -m "修复: 审查14项逐一闭环——CLI stdin监听泄漏/vim拦截中断/死路模型降级/v2 compact死端点移除/EDITOR元字符拒绝/状态行零网络/ChatPanel定时器清理/压测env开关/品牌化GycCode云端/effect豁免记录"
echo COMMIT_EXIT=%ERRORLEVEL% > commit-out.log
