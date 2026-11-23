# Opens a .pptx with icons made by Nova Slides (e2e-slides-icons.mjs --out) in the real PowerPoint and checks that PowerPoint takes them as SVG graphics, keeps
# their size and alternative text, and that after PowerPoint saves a copy the icons are still SVG with their PNG. Runs in a job with a time limit.
# Usage: powershell -File scripts/office-icons/check-powerpoint.ps1 -File <iconos.pptx> [-Limit 120]
param([Parameter(Mandatory = $true)][string]$File, [int]$Limit = 120)
$File = (Resolve-Path $File).Path
$copy = Join-Path ([IO.Path]::GetTempPath()) ('nova-iconos-ppt-' + [guid]::NewGuid().ToString('N') + '.pptx')
$start = Get-Date
$job = Start-Job -ArgumentList $File, $copy -ScriptBlock {
  param($File, $copy)
  function Rec($name, $ok, $detail) { [pscustomobject]@{ Comprobacion = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALLA' }); Detalle = $detail } }
  function Parts($f) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($f); try { @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() } }
  try {
    $ppt = New-Object -ComObject PowerPoint.Application
    $p = $ppt.Presentations.Open($File, 0, 0, 0)
    $sl = $p.Slides.Item(1)
    $n = $sl.Shapes.Count
    $types = @(); foreach ($i in 1..$n) { $types += [int]$sl.Shapes.Item($i).Type }
    Rec 'PowerPoint: abre el .pptx sin avisos y ve los dos iconos' ($n -eq 2) "formas: $n"
    # 28 = msoGraphic (an SVG), 13 = msoPicture
    Rec 'PowerPoint: los iconos son gráficos SVG (tipo 28)' (@($types | Where-Object { $_ -eq 28 }).Count -eq $n) "tipos: $($types -join ',')"
    $alts = @(); foreach ($i in 1..$n) { $alts += $sl.Shapes.Item($i).AlternativeText }
    Rec 'PowerPoint: conserva el texto alternativo' (@($alts | Where-Object { $_ -match 'Estrella' }).Count -eq $n) ($alts -join ' | ')
    $p.SaveCopyAs($copy)
    $p.Close()
    $parts = Parts $copy
    $svg = @($parts | Where-Object { $_ -match '^ppt/media/.*\.svg$' })
    $png = @($parts | Where-Object { $_ -match '^ppt/media/.*\.png$' })
    Rec 'PowerPoint: al guardar de nuevo conserva el SVG y el PNG de cada icono' (($svg.Count -ge 2) -and ($png.Count -ge 2)) "svg: $($svg.Count); png: $($png.Count)"
    $ppt.Quit()
  } catch {
    Rec 'PowerPoint: error' $false $_.Exception.Message
  }
}
if (Wait-Job $job -Timeout $Limit) { $res = @(Receive-Job $job) }
else {
  Stop-Job $job
  $res = @([pscustomobject]@{ Comprobacion = "PowerPoint: no respondió en $Limit s"; Resultado = 'FALLA'; Detalle = '' })
  Get-Process POWERPNT -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $start } | ForEach-Object { Stop-Process -Id $_.Id -Force }
}
Remove-Job $job -Force
Remove-Item $copy -ErrorAction SilentlyContinue
$res | Format-List
if (@($res | Where-Object { $_.Resultado -ne 'OK' }).Count) { exit 1 }
