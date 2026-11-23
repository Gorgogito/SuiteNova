# Opens estilos.docx in the real Word and writes what each cell of each table looks like (shading, bold, text colour, borders) to cells.json.
# Usage: powershell -File scripts/office-tables/dump-word-styles.ps1 -Dir <folder with estilos.docx>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open((Join-Path $Dir 'estilos.docx'), $false, $true)
  $out = New-Object System.Collections.ArrayList
  $n = $doc.Tables.Count
  for ($i = 1; $i -le $n; $i++) {
    $t = $doc.Tables.Item($i)
    $cells = New-Object System.Collections.ArrayList
    foreach ($c in $t.Range.Cells) {
      $b = @{}
      foreach ($k in @(@('t', -1), @('l', -2), @('b', -3), @('r', -4))) {
        $bd = $c.Borders.Item($k[1])
        $b[$k[0]] = @{ style = [int]$bd.LineStyle; width = [int]$bd.LineWidth; color = [int]$bd.Color }
      }
      [void]$cells.Add(@{ row = $c.RowIndex; col = $c.ColumnIndex; fill = [int]$c.Shading.BackgroundPatternColor; bold = [int]$c.Range.Font.Bold; color = [int]$c.Range.Font.Color; borders = $b })
    }
    [void]$out.Add(@{ index = $i; style = $t.Style.NameLocal; cells = $cells })
  }
  $out | ConvertTo-Json -Depth 8 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'celdas.json')
  $doc.Close($false)
  Write-Output "tablas leidas: $n"
} finally {
  $word.Quit()
}
