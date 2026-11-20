# Abre con Word real el revision.docx que crea `node scripts/real-review.mjs <carpeta>` y escribe los comentarios y los cambios controlados que ve.
# Uso: pwsh scripts/real-review.ps1 -Dir <carpeta>
param([string]$Dir = $PSScriptRoot)
$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0
$doc = $w.Documents.Open("$Dir\revision.docx", $false, $true)
"texto: '$($doc.Content.Text.Trim())'"
"comentarios: $($doc.Comments.Count)"
foreach ($c in $doc.Comments) {
  "  [$($c.Author) / $($c.Initial)] sobre '$($c.Scope.Text)' hecho=$($c.Done) fecha=$($c.Date.ToString('s')): '$(($c.Range.Text) -replace "`r|`n", ' | ')' respuestas=$($c.Replies.Count)"
  foreach ($r in $c.Replies) { "      respuesta [$($r.Author)] '$(($r.Range.Text) -replace "`r|`n", ' | ')'" }
}
"cambios controlados: $($doc.Revisions.Count)"
foreach ($r in $doc.Revisions) { "  tipo=$($r.Type) autor=$($r.Author) fecha=$($r.Date.ToString('s')) texto='$($r.Range.Text)'" }
$doc.Close($false); $w.Quit()
