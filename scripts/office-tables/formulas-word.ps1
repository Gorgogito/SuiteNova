# Evaluates formulas of table cells in the real Word: for every case of casos.json it builds a table with the given cell texts, puts the formula
# field in the given cell, updates it and reads the result. Writes resultados.json. Also reports the decimal and list separators of Word.
# Usage: powershell -File scripts/office-tables/formulas-word.ps1 -Dir <folder with casos.json>
param([Parameter(Mandatory = $true)][string]$Dir, [string]$NamesFile = '')
$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'casos.json') | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Add()
  $dec = $word.International('wdDecimalSeparator')
  $list = $word.International('wdListSeparator')
  $results = New-Object System.Collections.ArrayList
  $names = @{}
  if ($NamesFile -and (Test-Path $NamesFile)) { (Get-Content -Raw -Encoding UTF8 $NamesFile | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $names[$_.Name] = $_.Value } }
  $i = 0
  foreach ($c in $cases) {
    $i++
    $rows = $c.cells.Count
    $cols = ($c.cells | ForEach-Object { $_.Count } | Measure-Object -Maximum).Maximum
    $range = $doc.Content
    $range.Collapse(0)
    $tbl = $doc.Tables.Add($range, $rows, $cols)
    for ($r = 0; $r -lt $rows; $r++) {
      for ($k = 0; $k -lt $c.cells[$r].Count; $k++) {
        $tbl.Cell($r + 1, $k + 1).Range.Text = [string]$c.cells[$r][$k]
      }
    }
    $cell = $tbl.Cell($c.row + 1, $c.col + 1)
    $cell.Range.Text = ''
    # Word evaluates with the names of its own language: Spanish Word wants SUMA(ARRIBA), not SUM(ABOVE)
    $formula = [string]$c.formula
    if ($names.Count -gt 0) { foreach ($k in $names.Keys) { $formula = [regex]::Replace($formula, "(?<![A-Za-z])$k(?![A-Za-z])", $names[$k]) } }
    $rr = $cell.Range
    $rr.Collapse(1)
    $field = $doc.Fields.Add($rr, -1, $formula, $false)
    [void]$field.Update()
    $text = [string]$field.Result.Text
    [void]$results.Add(@{ index = $i; name = $c.name; formula = $formula; result = $text.Trim() })
    $doc.Content.InsertParagraphAfter()
  }
  @{ decimal = $dec; list = $list; results = $results } | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'resultados.json')
  $doc.Close($false)
  Write-Output "casos: $($results.Count), decimal '$dec', lista '$list'"
} finally {
  $word.Quit()
}
