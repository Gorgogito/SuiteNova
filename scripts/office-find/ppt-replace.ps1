# Runs the plain replacements of casos-ppt.json in the real PowerPoint (TextRange.Replace, all of them) and writes the text left to resultados-ppt.json.
# Usage: powershell -File scripts/office-find/ppt-replace.ps1 -Dir <folder with casos-ppt.json>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'casos-ppt.json') | ConvertFrom-Json
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Add(0)
  $slide = $pres.Slides.AddSlide(1, $pres.SlideMaster.CustomLayouts.Item(7))
  $box = $slide.Shapes.AddTextbox(1, 20, 20, 600, 100)
  $results = New-Object System.Collections.ArrayList
  foreach ($c in $cases) {
    $box.TextFrame.TextRange.Text = [string]$c.text
    $n = 0
    try {
      while ($n -lt 50) {
        $r = $box.TextFrame.TextRange.Replace([string]$c.query, [string]$c.rep, 0, [int][bool]$c.matchCase, [int][bool]$c.whole)
        if ($null -eq $r) { break }
        $n++
      }
      $out = $box.TextFrame.TextRange.Text
    } catch { $out = '<error>' }
    [void]$results.Add(@{ name = $c.name; text = $out })
  }
  @{ results = $results } | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'resultados-ppt.json')
  $pres.Close()
  Write-Output "casos: $($results.Count)"
} finally { $app.Quit() }
