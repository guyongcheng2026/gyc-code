# gyc memory watchdog
# Samples every gyc process (RSS / private bytes / threads / uptime), system free
# memory and memory-fatal log occurrences into a CSV, so 1h/6h/12h/24h runs can be
# reviewed afterwards for growth or repeated fatal exits (the acceptance signal is a
# flat RSS for one process id, uptime increasing, and fatal_delta staying 0).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mem-watch.ps1 -Hours 24
# Output (default): %TEMP%\gyccode\mem-watch.csv
# Failures while sampling are appended to <Out>.error.log instead of being swallowed.
param(
  [int]$Hours = 24,
  [int]$IntervalSec = 60,
  [string]$Out = "$env:TEMP\gyccode\mem-watch.csv",
  [string]$Log = "$env:USERPROFILE\.local\share\gyccode\log\gyccode.log"
)

if ($IntervalSec -lt 10) { $IntervalSec = 10 }
$deadline = (Get-Date).AddHours($Hours)
$dir = Split-Path $Out
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (-not (Test-Path $Out)) {
  "ts;elapsed_min;pid;name;rss_mb;private_mb;threads;uptime_min;free_mb;fatal_total;fatal_delta" | Set-Content -LiteralPath $Out
}
$start = Get-Date
$tick = 0
$fatalTotal = 0
$fatalSeen = -1
while ((Get-Date) -lt $deadline) {
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $free = if ($os) { [math]::Round($os.FreePhysicalMemory / 1024) } else { -1 }
    # 全量扫描日志代价随文件线性增长，每 10 轮统计一次即可满足小时级判定
    if ($tick % 10 -eq 0 -and (Test-Path $Log)) {
      # 只匹配真实致命行（level=Error run=main memory-fatal ...）：日志里其它位置
      # 出现的同名文本（例如 grep 命令本身被记入 asking 行）会造成假阳性。
      $now = (Select-String -LiteralPath $Log -Pattern "level=Error run=main memory-fatal" -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
      # 日志轮转/截断会让计数回落：此时重置基线，否则增量会被钳成 0，
      # 轮转之后发生的 fatal 在计数追上旧基线前完全不可见（假阴性）。
      if ($now -lt $fatalTotal) { $fatalSeen = $now }
      $fatalTotal = $now
      if ($fatalSeen -lt 0) { $fatalSeen = $fatalTotal }
    }
    $fatalDelta = [math]::Max(0, $fatalTotal - $fatalSeen)
    $elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='bun.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match "gyc-code|gyccode" -and
        $_.CommandLine -notmatch "bun test|esbuild|typescript"
      }
    if (-not $procs) {
      "$(Get-Date -Format s);$elapsed;0;none;0;0;0;0;$free;$fatalTotal;$fatalDelta" | Add-Content -LiteralPath $Out
    } else {
      foreach ($p in $procs) {
        $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $rss = [math]::Round($proc.WorkingSet64 / 1MB)
        $priv = [math]::Round($proc.PrivateMemorySize64 / 1MB)
        # uptime 便于区分「同一进程持续增长」与「进程重启后的新基线」
        $up = ""
        try { $up = [math]::Round(((Get-Date) - $proc.StartTime).TotalMinutes, 1) } catch {}
        "$(Get-Date -Format s);$elapsed;$($proc.Id);$($proc.ProcessName);$rss;$priv;$($proc.Threads.Count);$up;$free;$fatalTotal;$fatalDelta" | Add-Content -LiteralPath $Out
      }
    }
    $tick++
  } catch {
    "$(Get-Date -Format s);ERROR;$($_.Exception.Message)" | Add-Content -LiteralPath "$Out.error.log"
  }
  Start-Sleep -Seconds $IntervalSec
}
