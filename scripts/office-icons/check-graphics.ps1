# Opens a .docx with an icon that has fill, outline and a shadow (made by e2e-writer-icons-edit.mjs) in the real Word and checks that Word sees the
# icon as an SVG graphic with its shadow (Word draws the picture's own effects), and that after Word saves a copy the SVG keeps its colors.
# Usage: powershell -File scripts/office-icons/check-graphics.ps1 -File <iconos-ed.docx> [-Limit 120]
param([Parameter(Mandatory = $true)][string]$File, [int]$Limit = 120)
$File = (Resolve-Path $File).Path
$copy = Join-Path ([IO.Path]::GetTempPath()) ('nova-graficos-word-' + [guid]::NewGuid().ToString('N') + '.docx')
$start = Get-Date
$job = Start-Job -ArgumentList $File, $copy -ScriptBlock {
  param($File, $copy)
  function Rec($name, $ok, $detail) { [pscustomobject]@{ Comprobacion = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALLA' }); Detalle = $detail } }
  function SvgText($f) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($f); try { foreach ($e in $z.Entries) { if ($e.FullName -match '^word/media/.*\.svg$') { $r = New-Object IO.StreamReader($e.Open()); $t = $r.ReadToEnd(); $r.Dispose(); return $t } } } finally { $z.Dispose() } }
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false; $word.DisplayAlerts = 0
    $d = $word.Documents.Open($File, $false, $false)
    $s = $d.InlineShapes.Item(1)
    Rec 'Word: abre el icono como gráfico SVG (tipo 17)' ([int]$s.Type -eq 17) "tipo: $([int]$s.Type)"
    $sh = $null; try { $sh = $s.ConvertToShape(); } catch {}
    $vis = $false; $blur = 0; $dist = 0; $dir = 0
    if ($sh) { $vis = [bool]$sh.Shadow.Visible; $blur = $sh.Shadow.Blur; $dist = [math]::Round([math]::Sqrt([math]::Pow($sh.Shadow.OffsetX, 2) + [math]::Pow($sh.Shadow.OffsetY, 2)), 1) }
    Rec 'Word: ve la sombra del icono (la dibuja él)' $vis "visible: $vis; difuminado: $blur pt; distancia: $dist pt"
    $d.SaveAs2([ref]$copy, [ref]16)
    $d.Close($false)
    $svg = SvgText $copy
    Rec 'Word: al guardar de nuevo el SVG conserva el relleno y el contorno' (($svg -match '#ffc000') -and ($svg -match '#002060')) (($svg -replace '<path[^>]*>', '') -replace '\s+', ' ')
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
