# Opens layout.docx (written by packages/writer-core/src/office-tables.test.ts) in the real Word and prints what Word sees of the table:
# merged cells, shading and borders of a cell, alternative text, header row. Usage: powershell -File layout-word.ps1 -Dir <folder>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open((Join-Path $Dir 'layout.docx'), $false, $true)
  $t = $doc.Tables.Item(1)
  $o = [ordered]@{}
  $o.cells = $t.Range.Cells.Count
  $o.uniform = $t.Uniform
  $o.dims = @($t.Range.Cells | ForEach-Object { '{0},{1}' -f $_.RowIndex, $_.ColumnIndex }) -join ' '
  $o.title = $t.Title
  $o.descr = $t.Descr
  $c1 = $t.Cell(1, 1)
  $o.cell11 = $c1.Range.Text.Trim([char]7, [char]13)
  $o.cell11width = [math]::Round($c1.Width)
  $o.cell12 = $t.Cell(1, 2).Range.Text.Trim([char]7, [char]13)
  $o.shading_b1 = $t.Cell(2, 2).Shading.BackgroundPatternColor
  $b = $t.Cell(3, 2)
  $o.top_b2 = @($b.Borders.Item(-1).LineStyle, $b.Borders.Item(-1).LineWidth, $b.Borders.Item(-1).Color)
  $o.bottom_b2 = @($b.Borders.Item(-3).LineStyle, $b.Borders.Item(-3).LineWidth, $b.Borders.Item(-3).Color)
  $o.style = [string]$t.Style.NameLocal
  $o | ConvertTo-Json -Compress
  $doc.Close($false)
} finally {
  $word.Quit()
}
