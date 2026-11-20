# Abre con PowerPoint real los .pptx que crea `node scripts/real-comments.mjs <carpeta>` y escribe los comentarios que ve.
# Uso: pwsh scripts/real-comments.ps1 -Dir <carpeta>
param([string]$Dir = $PSScriptRoot)
$p = New-Object -ComObject PowerPoint.Application
$pr = $p.Presentations.Open("$Dir\comentarios.pptx", $true, $false, $false)
foreach ($s in $pr.Slides) {
  "diapositiva $($s.SlideIndex): $($s.Comments.Count) comentarios"
  foreach ($c in $s.Comments) {
    "  [$($c.Author) / $($c.AuthorInitials)] en ($($c.Left),$($c.Top)): '$($c.Text -replace "`r|`n", ' | ')' respuestas=$($c.Replies.Count)"
    foreach ($r in $c.Replies) { "      respuesta [$($r.Author)]: '$($r.Text -replace "`r|`n", ' | ')'" }
  }
}
$pr.Close(); $p.Quit()
