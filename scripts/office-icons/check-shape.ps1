# Opens a .docx with an icon converted to a shape (made by e2e-writer-icons-edit.mjs --out2) in the real Word and checks that Word sees a freeform with its
# nodes, fill and outline, and that Word can edit it (change the fill) and save it again with its custom geometry.
# Usage: powershell -File scripts/office-icons/check-shape.ps1 -File <forma.docx> [-Limit 120]
param([Parameter(Mandatory = $true)][string]$File, [int]$Limit = 120)
$File = (Resolve-Path $File).Path
$copy = Join-Path ([IO.Path]::GetTempPath()) ('nova-forma-word-' + [guid]::NewGuid().ToString('N') + '.docx')
$start = Get-Date
$job = Start-Job -ArgumentList $File, $copy -ScriptBlock {
  param($File, $copy)
  function Rec($name, $ok, $detail) { [pscustomobject]@{ Comprobacion = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALLA' }); Detalle = $detail } }
  function DocXml($f) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($f); try { $e = $z.GetEntry('word/document.xml'); $r = New-Object IO.StreamReader($e.Open()); $t = $r.ReadToEnd(); $r.Dispose(); $t } finally { $z.Dispose() } }
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false; $word.DisplayAlerts = 0
    $d = $word.Documents.Open($File, $false, $false)
    $n = $d.Shapes.Count; $i = $d.InlineShapes.Count
    Rec 'Word: abre el .docx sin avisos y ve la forma' (($n + $i) -ge 1) "formas: $n; en línea: $i"
    $sh = $null
    if ($n -ge 1) { $sh = $d.Shapes.Item(1) } elseif ($i -ge 1) { $sh = $d.InlineShapes.Item(1).ConvertToShape() }
    $type = [int]$sh.Type
    $nodes = 0; try { $nodes = $sh.Nodes.Count } catch {}
    Rec 'Word: es un dibujo libre con nodos' (($type -eq 5) -or ($nodes -gt 10)) "tipo: $type (5 = forma libre); nodos: $nodes"
    $rgb = [int]$sh.Fill.ForeColor.RGB
    $hex = '{0:X2}{1:X2}{2:X2}' -f ($rgb -band 255), (($rgb -shr 8) -band 255), (($rgb -shr 16) -band 255)
    Rec 'Word: relleno verde y contorno azul oscuro del icono' (($hex -eq '00B050') -and ($sh.Line.Visible -ne 0)) "relleno: #$hex; contorno visible: $($sh.Line.Visible); alt: $($sh.AlternativeText)"
    $sh.Fill.ForeColor.RGB = 255   # rojo, como si el usuario cambiara el relleno en Word
    $d.SaveAs2([ref]$copy, [ref]16)
    $d.Close($false)
    $xml = DocXml $copy
    Rec 'Word: guardada de nuevo conserva la geometría personalizada' ($xml -match 'custGeom') "custGeom: $([bool]($xml -match 'custGeom')); curvas: $([regex]::Matches($xml, 'cubicBezTo').Count)"
    Rec 'Word: y el relleno que se le puso' ($xml -match 'FF0000') ''
    $word.Quit()
  } catch {
    Rec 'Word: error' $false $_.Exception.Message
  }
}
if (Wait-Job $job -Timeout $Limit) { $res = @(Receive-Job $job) }
else {
  Stop-Job $job
  $res = @([pscustomobject]@{ Comprobacion = "Word: no respondió en $Limit s"; Resultado = 'FALLA'; Detalle = '' })
  Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $start } | ForEach-Object { Stop-Process -Id $_.Id -Force }
}
Remove-Job $job -Force
Remove-Item $copy -ErrorAction SilentlyContinue
$res | Format-List
if (@($res | Where-Object { $_.Resultado -ne 'OK' }).Count) { exit 1 }
