# Opens an .xlsx with an icon made by Nova Calc (e2e-calc-icons.mjs --out) in the real Excel and checks that Excel takes it as an SVG graphic, keeps its size and
# alternative text, and that after Excel saves a copy the icon is still SVG with its PNG. Runs in a job with a time limit; only the Excel started here is closed.
# Usage: powershell -File scripts/office-icons/check-excel.ps1 -File <iconos.xlsx> [-Limit 120]
param([Parameter(Mandatory = $true)][string]$File, [int]$Limit = 120)
$File = (Resolve-Path $File).Path
$copy = Join-Path ([IO.Path]::GetTempPath()) ('nova-iconos-xls-' + [guid]::NewGuid().ToString('N') + '.xlsx')
$start = Get-Date
$job = Start-Job -ArgumentList $File, $copy -ScriptBlock {
  param($File, $copy)
  function Rec($name, $ok, $detail) { [pscustomobject]@{ Comprobacion = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALLA' }); Detalle = $detail } }
  function Parts($f) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($f); try { @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() } }
  try {
    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false; $xl.DisplayAlerts = $false
    $wb = $xl.Workbooks.Open($File, 0, $true)
    $ws = $wb.Worksheets.Item(1)
    $n = $ws.Shapes.Count
    Rec 'Excel: abre el .xlsx sin avisos y ve el icono' ($n -eq 1) "formas: $n"
    $s = $ws.Shapes.Item(1)
    # 28 = msoGraphic (an SVG), 13 = msoPicture
    Rec 'Excel: el icono es un gráfico SVG (tipo 28)' ([int]$s.Type -eq 28) "tipo: $([int]$s.Type)"
    Rec 'Excel: tiene su tamaño (64 px = 48 pt) y su texto alternativo' (([math]::Abs($s.Width - 48) -lt 1) -and ($s.AlternativeText -match 'Calendario')) "ancho: $([math]::Round($s.Width,1)); alt: $($s.AlternativeText)"
    $wb.SaveCopyAs($copy)
    $wb.Close($false)
    $parts = Parts $copy
    $svg = @($parts | Where-Object { $_ -match '^xl/media/.*\.svg$' })
    $png = @($parts | Where-Object { $_ -match '^xl/media/.*\.png$' })
    Rec 'Excel: al guardar de nuevo conserva el SVG y el PNG del icono' (($svg.Count -ge 1) -and ($png.Count -ge 1)) "svg: $($svg.Count); png: $($png.Count)"
    $xl.Quit()
  } catch {
    Rec 'Excel: error' $false $_.Exception.Message
  }
}
if (Wait-Job $job -Timeout $Limit) { $res = @(Receive-Job $job) }
else {
  Stop-Job $job
  $res = @([pscustomobject]@{ Comprobacion = "Excel: no respondió en $Limit s"; Resultado = 'FALLA'; Detalle = '' })
  Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $start } | ForEach-Object { Stop-Process -Id $_.Id -Force }
}
Remove-Job $job -Force
Remove-Item $copy -ErrorAction SilentlyContinue
$res | Format-List
if (@($res | Where-Object { $_.Resultado -ne 'OK' }).Count) { exit 1 }
