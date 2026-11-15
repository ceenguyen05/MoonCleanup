# T06: 60 s --realtime S4 lag runs with the machine load sampled every second DURING each run.
# Usage (repo root): powershell -File prototypes/dust-sim/t06/lag-run.ps1 -Tag round1 -Approaches idle,p1-scalar-procedural,...
# A reading is accepted only when the mean total CPU load during the run is below 25 %.
param(
  [string]$Tag = "round1",
  [string[]]$Approaches = @("idle", "p1-scalar-procedural", "p2-stroke-atlas-ledger", "p3-client-paint-minmerge"),
  [int]$Seconds = 60,
  # Before each run: wait until a 10 s sample of the total CPU load is below this, at most GateWaitMinutes in total.
  [int]$GatePct = 0,
  [int]$GateWaitMinutes = 10
)
$ErrorActionPreference = "Continue"
# "powershell -File" passes "a,b,c" as one string: split it.
$Approaches = @($Approaches | ForEach-Object { $_ -split "," } | Where-Object { $_ -ne "" })
$env:PATH = "$env:APPDATA\fnm\aliases\default;$env:PATH"
$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$dust = "$root\prototypes\dust-sim"
$out = "$dust\results\t06\lag\$Tag"
New-Item -ItemType Directory -Force $out | Out-Null
$log = "$out\lag-log.jsonl"
$counter = '\Processor(_Total)\% Processor Time'

$gateDeadline = (Get-Date).AddMinutes($GateWaitMinutes)
foreach ($a in $Approaches) {
  $pre = $null
  if ($GatePct -gt 0) {
    do {
      $g = Get-Counter $counter -SampleInterval 1 -MaxSamples 10
      $pre = [math]::Round(($g.CounterSamples | Measure-Object CookedValue -Average).Average, 1)
    } while ($pre -ge $GatePct -and (Get-Date) -lt $gateDeadline)
  }
  $loadFile = "$out\$a.load.txt"
  if (Test-Path $loadFile) { Remove-Item $loadFile -Confirm:$false }
  $job = Start-Job -ScriptBlock {
    param($counter, $loadFile)
    Get-Counter $counter -SampleInterval 1 -Continuous | ForEach-Object {
      Add-Content -Path $loadFile -Value ([math]::Round($_.CounterSamples[0].CookedValue, 1))
    }
  } -ArgumentList $counter, $loadFile
  Start-Sleep -Seconds 3
  $t0 = Get-Date
  $lag = $null
  $extra = ""
  if ($a -eq "idle") {
    $json = & node "$dust\t06\idle-lag-control.mjs" $Seconds
    $lag = ($json | ConvertFrom-Json).lagP99Ms
    $extra = $json
  } else {
    Push-Location "$root\tools\bots"
    $res = "$out\$a"
    & node --import tsx "$dust\harness\src\cli.ts" run --adapter "$dust\$a\harness-adapter.ts" --grid "$dust\$a\grid.ts" --results $res --tier floor --scenarios S4 --realtime --max-sim-seconds $Seconds | Out-Null
    Pop-Location
    $s4 = Get-Content "$res\$a\S4.json" -Raw | ConvertFrom-Json
    $m = $s4.metrics | Where-Object { $_.id -eq "s4.eventLoopLagP99Ms" -or $_.name -eq "s4.eventLoopLagP99Ms" -or $_.metric -eq "s4.eventLoopLagP99Ms" }
    if ($m) { $lag = $m.value }
  }
  $t1 = Get-Date
  Stop-Job $job; Remove-Job $job -Force
  $loads = @(Get-Content $loadFile | ForEach-Object { [double]$_ })
  $stat = $loads | Measure-Object -Average -Maximum -Minimum
  $sorted = $loads | Sort-Object
  $p90 = $sorted[[math]::Min($sorted.Count - 1, [int][math]::Floor($sorted.Count * 0.9))]
  $valid = ($null -ne $lag) -and ($stat.Count -ge 30) -and ($stat.Average -lt 25)
  $row = [ordered]@{
    tag = $Tag; approach = $a; start = $t0.ToString("s"); wallSeconds = [math]::Round(($t1 - $t0).TotalSeconds, 1)
    lagP99Ms = $lag; loadMeanPct = [math]::Round($stat.Average, 1); loadP90Pct = $p90; loadMaxPct = $stat.Maximum
    loadMinPct = $stat.Minimum; loadSamples = $stat.Count; preGateLoadPct = $pre; acceptedBelow25 = $valid; extra = $extra
  }
  ($row | ConvertTo-Json -Compress) | Add-Content -Path $log
  Write-Output ($row | ConvertTo-Json -Compress)
}
