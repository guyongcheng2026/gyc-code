# gyc memory watchdog
# Samples every gyc process (RSS / private bytes / threads / uptime), system free
# memory and real memory-fatal occurrences into a CSV, so 1h/6h/12h/24h runs can be
# reviewed afterwards for growth or repeated fatal exits. Acceptance signal: one
# process id whose uptime grows while RSS stays inside the design value, fatal_delta 0.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mem-watch.ps1 -Hours 24
# Output (default): %TEMP%\gyccode\mem-watch.csv
# Sampling failures go to <Out>.error.log instead of being swallowed.
# NOTE: keep this file ASCII-only. PowerShell 5.1 parses BOM-less files with the ANSI
# code page, so non-ASCII comments corrupt the token stream and break parsing.
param(
  [int]$Hours = 24,
  [int]$IntervalSec = 60,
  [string]$Out = "$env:TEMP\gyccode\mem-watch.csv",
  [string]$Log = "$env:USERPROFILE\.local\share\gyccode\log\gyccode.log"
)

if ($IntervalSec -lt 10) { $IntervalSec = 10 }
$deadline = (Get-Date).AddHours($Hours)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
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

    # Scanning the whole log costs O(file size), so refresh every 10 ticks (10 min).
    if ($tick % 10 -eq 0 -and (Test-Path $Log)) {
      $now = $fatalTotal
      # Only real fatal lines count: the same words also appear inside asking
      # patterns (e.g. a grep command that mentions memory-fatal).
      try {
        $text = Get-Content -LiteralPath $Log -Raw -ErrorAction Stop
        # Anchor to the start of a log line: the same words also appear inside
        # asking patterns (a command that mentions memory-fatal), which must not
        # count as a fatal exit.
        $now = ([regex]::Matches($text, "(?m)^timestamp=\S+ level=Error run=main memory-fatal")).Count
      } catch {
        # Log busy or being rotated: keep the previous count, never zero it silently.
      }
      # Log rotation drops the count: reset the baseline instead of clamping the
      # delta at 0, otherwise post-rotation fatals stay invisible until the count
      # climbs back past the stale baseline.
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
        # uptime separates "one process growing" from "new baseline after restart".
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
