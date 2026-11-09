注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：redirect_host 可被中间人劫持至恶意域，后续请求泄露配对凭据 P0级
## 问题1分析:
src/gyccode/gateway/pair.ts:80 `if (host) base = \`https://\${host}\``，statusResp.redirect_host 来自远程响应且无白名单校验，攻击者可将 base 劫持至攻击者控制域，后续 get_qrcode_status 轮询及 confirmed 后的 token/baseUrl 等凭据将发送给恶意服务器。
### 问题1修复后的代码：
```diff
-    } else if (status === "scaned_but_redirect") {
-      const host = String(statusResp.redirect_host ?? "")
-      if (host) base = `https://${host}`
+    } else if (status === "scaned_but_redirect") {
+      const host = String(statusResp.redirect_host ?? "")
+      const allowed = new Set(["ilinkai.weixin.qq.com"])
+      if (host && allowed.has(new URL(`https://${host}`).hostname)) base = `https://${host}`
```
# 问题2：token/accountId 明文返回且未脱敏日志，存在凭据泄露 P0级
## 问题2分析:
src/gyccode/gateway/pair.ts:93 `return { accountId, token, baseUrl, homeChannel }` 明文返回配对凭据；前文 index.ts:91 `log(\`微信连接成功，account_id=${accountId}\`)` 将 accountId 写日志。凭据应只在调用方加密落盘，不应明文层层传递与记录。
### 问题2修复后的代码：
```diff
-      log(`微信连接成功，account_id=${accountId}`)
+      log("微信连接成功")
       return { accountId, token, baseUrl, homeChannel }
```