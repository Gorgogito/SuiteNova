# Opens estilos.pptx in the real PowerPoint and writes what each cell of the table of each slide looks like (fill, bold, text colour, borders) to celdas-pptx.json.
# Usage: powershell -File scripts/office-tables/dump-pptx-styles.ps1 -Dir <folder with estilos.pptx>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open((Join-Path $Dir 'estilos.pptx'), $true, $false, $false)
  $out = New-Object System.Collections.ArrayList
  foreach ($slide in $pres.Slides) {
    $tbl = $null
    foreach ($sh in $slide.Shapes) { if ($sh.HasTable) { $tbl = $sh.Table; break } }
    if (-not $tbl) { continue }
    $cells = New-Object System.Collections.ArrayList
    for ($r = 1; $r -le $tbl.Rows.Count; $r++) {
      for ($c = 1; $c -le $tbl.Columns.Count; $c++) {
        $cell = $tbl.Cell($r, $c)
        $b = @{}
        foreach ($k in @(@('t', 1), @('l', 2), @('b', 3), @('r', 4))) {
          $bd = $cell.Borders.Item($k[1])
          $b[$k[0]] = @{ visible = [int]$bd.Visible; weight = [double]$bd.Weight; color = [int]$bd.ForeColor.RGB; transparency = [double]$bd.Transparency }
        }
        $f = $cell.Shape.Fill
        $font = $cell.Shape.TextFrame.TextRange.Font
        [void]$cells.Add(@{ row = $r; col = $c; fillVisible = [int]$f.Visible; fill = [int]$f.ForeColor.RGB; fillTransparency = [double]$f.Transparency; bold = [int]$font.Bold; color = [int]$font.Color.RGB; borders = $b })
      }
    }
    [void]$out.Add(@{ index = $slide.SlideIndex; style = $tbl.Style.Name; cells = $cells })
  }
  $out | ConvertTo-Json -Depth 8 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'celdas-pptx.json')
  $pres.Close()
  Write-Output "tablas leidas: $($out.Count)"
} finally {
  $ppt.Quit()
}
