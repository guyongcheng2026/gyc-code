// 由 scripts/build-webapp.mjs 在构建时覆盖为真实清单（URL 路径 → 磁盘绝对路径）。
// 占位空清单：embeddedUI() 返回 null → serveUIEffect 走 dev 代理回退。
export default {} as Record<string, string>
