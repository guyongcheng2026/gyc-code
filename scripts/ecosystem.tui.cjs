// scripts/ecosystem.tui.cjs — gyc 长跑稳定性验证（11 维矩阵·稳定性维度）
// 用途：以 pm2 常驻 gyc serve，供 1h/4h/8h/24h 连续运行崩溃监测。
// 启动： bun x pm2 start scripts/ecosystem.tui.cjs
// 巡检： node scripts/stability-watch.mjs   （追加写 stability-log.jsonl）
// 结果： pm2 l；type stability-log.jsonl；崩溃判据 = restart_count 增长或 HTTP 探测失败
module.exports = {
  apps: [
    {
      name: "gyc-stability",
      script: "bin/gyc",
      args: "serve --port 4300 --hostname 127.0.0.1",
      interpreter: "node",
      cwd: __dirname + "/..",
      autorestart: true,
      max_restarts: 50,
      max_memory_restart: "1500M",
      out_file: "./stability-out.log",
      error_file: "./stability-err.log",
      merge_logs: true,
      time: true,
      env: {
        GYCCODE_SERVER_PASSWORD: "", // 回环地址专用实例，免认证便于探活
        NODE_ENV: "production",
      },
    },
  ],
}
