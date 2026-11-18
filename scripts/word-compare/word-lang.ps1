# Abre lang.docx en Word y lang.pptx en PowerPoint reales y lee idioma, «no revisar» y errores de ortografía de cada tramo.
$dir = $PSScriptRoot
$w = New-Object -ComObject Word.Application
$w.Visible = $false; $w.DisplayAlerts = 0
try {
  $d = $w.Documents.Open("$dir\lang.docx", $false, $true)
  foreach ($p in $d.Paragraphs) {
    $r = $p.Range
    "WORD  «$($r.Text.Trim())» LanguageID=$($r.LanguageID) NoProofing=$($r.NoProofing) ortografía=$($r.SpellingErrors.Count)"
  }
  $d.Close([ref]0)
} finally { $w.Quit([ref]0) }
$pp = New-Object -ComObject PowerPoint.Application
try {
  $pr = $pp.Presentations.Open("$dir\lang.pptx", $true, $false, $false)
  foreach ($sh in $pr.Slides.Item(1).Shapes) {
    if ($sh.HasTextFrame -and $sh.TextFrame.HasText) {
      foreach ($run in $sh.TextFrame.TextRange.Runs()) { "PPT   «$($run.Text)» LanguageID=$($run.LanguageID)" }
      foreach ($run in $sh.TextFrame2.TextRange.Runs()) { "PPT2  «$($run.Text)» LanguageID=$($run.LanguageID)" }
    }
  }
  $pr.Close()
} finally { $pp.Quit() }
