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

# Excel: las notas y los comentarios encadenados de comentarios.xlsx
$x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false
$wb = $x.Workbooks.Open("$Dir\comentarios.xlsx", 0, $true)
$ws = $wb.Worksheets(1)
"Excel: $($ws.Comments.Count) notas (con el marcador de cada conversación)"
foreach ($c in $ws.Comments) { "  $($c.Parent.Address($false,$false)) [$($c.Author)]: '$(($c.Text() -replace "`r|`n", ' | ').Substring(0, [Math]::Min(120, $c.Text().Length)))'" }
try { "Excel: $($ws.CommentsThreaded.Count) comentarios encadenados"; foreach ($t in $ws.CommentsThreaded) { "  $($t.Parent.Address($false,$false)) [$($t.Author.Name)] '$($t.Text())' respuestas=$($t.Replies.Count) resuelto=$($t.Resolved)" } } catch { "Excel: sin modelo de objetos de comentarios encadenados ($($_.Exception.Message))" }
$wb.Close($false); $x.Quit()
