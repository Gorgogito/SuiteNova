# Opens a .docx with icons made by Nova Writer in the real Word and checks that Word takes them as SVG graphics (not as flat pictures), keeps the size and the
# alternative text, and that after Word saves a copy the icons are still SVG with their PNG. Word runs in a job with a time limit; only the Word started here is closed.
# Usage: powershell -File scripts/office-icons/check-word.ps1 -File <iconos.docx> [-Limit 120]
param([Parameter(Mandatory = $true)][string]$File, [int]$Limit = 120)
$File = (Resolve-Path $File).Path
$copy = Join-Path ([IO.Path]::GetTempPath()) ('nova-iconos-word-' + [guid]::NewGuid().ToString('N') + '.docx')
$start = Get-Date
$job = Start-Job -ArgumentList $File, $copy -ScriptBlock {
  param($File, $copy)
  function Rec($name, $ok, $detail) { [pscustomobject]@{ Comprobacion = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALLA' }); Detalle = $detail } }
  function Parts($f) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($f); try { @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() } }
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false; $word.DisplayAlerts = 0
    $d = $word.Documents.Open($File, $false, $true)
    $n = $d.InlineShapes.Count
    Rec 'Word: abre el .docx sin avisos y ve los dos iconos' ($n -eq 2) "imágenes en línea: $n"
    $types = @(); foreach ($i in 1..$n) { $types += [int]$d.InlineShapes.Item($i).Type }
    # 17 = wdInlineShapeGraphic: Word takes it as an SVG graphic (a flat picture would be 3)
    $svgs = @($types | Where-Object { $_ -eq 17 }).Count; $wide = @($d.InlineShapes | Where-Object { [math]::Abs($_.Width - 48) -lt 1 }).Count
    Rec 'Word: los iconos son gráficos SVG (tipo 17) con su tamaño (64 px = 48 pt)' (($svgs -eq $n) -and ($wide -eq $n)) ("tipos: $($types -join ','); anchos: " + (@($d.InlineShapes | ForEach-Object { [math]::Round($_.Width, 1) }) -join ','))
    Rec 'Word: conserva el texto alternativo (nombre del icono)' (@($d.InlineShapes | Where-Object { $_.AlternativeText -match 'Calendario' }).Count -eq $n) (@($d.InlineShapes | ForEach-Object { $_.AlternativeText }) -join ' | ')
    $d.Close($false)
    $d = $word.Documents.Open($File, $false, $false)
    $d.SaveAs2([ref]$copy, [ref]16)
    $d.Close($false)
    $parts = Parts $copy
    $svg = @($parts | Where-Object { $_ -match '^word/media/.*\.svg$' })
    $png = @($parts | Where-Object { $_ -match '^word/media/.*\.png$' })
    Rec 'Word: al guardar de nuevo conserva el SVG de cada icono' ($svg.Count -ge 2) "svg: $($svg.Count): $($svg -join ', ')"
    Rec 'Word: y su PNG de respaldo' ($png.Count -ge 2) "png: $($png.Count)"
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
