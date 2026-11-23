# Runs the cases of casos-excel.json in the real Excel (Range.Find: wildcards, whole cell, match case) and writes the addresses found to resultados-excel.json.
# Usage: powershell -File scripts/office-find/excel-find.ps1 -Dir <folder with casos-excel.json>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'casos-excel.json') | ConvertFrom-Json
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  $results = New-Object System.Collections.ArrayList
  foreach ($c in $cases) {
    $ws.Cells.Clear() | Out-Null
    $i = 1
    foreach ($v in $c.cells) { $ws.Cells.Item($i, 1).NumberFormat = '@'; $ws.Cells.Item($i, 1).Value2 = [string]$v; $i++ }
    $found = New-Object System.Collections.ArrayList
    try {
      $lookAt = if ([bool]$c.whole) { 1 } else { 2 }
      $first = $ws.Cells.Find([string]$c.query, [Type]::Missing, -4163, $lookAt, 1, 1, [bool]$c.matchCase)
      if ($null -ne $first) {
        $addr = $first.Address()
        $cur = $first
        $guard = 0
        do {
          [void]$found.Add($cur.Row)
          $cur = $ws.Cells.FindNext($cur)
          $guard++
        } while ($null -ne $cur -and $cur.Address() -ne $addr -and $guard -lt 200)
      }
    } catch { $found = New-Object System.Collections.ArrayList; [void]$found.Add(-1) }
    [void]$results.Add(@{ name = $c.name; found = @($found | Sort-Object) })
  }
  @{ results = $results } | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'resultados-excel.json')
  $wb.Close($false)
  Write-Output "casos: $($results.Count)"
} finally { $xl.Quit() }
