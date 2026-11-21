# Opens the files made by make-files.mjs in the real Word, PowerPoint and Excel and checks what the text read from pictures (OCR) must not do: stop the file
# from opening, show up as text of the document, be found by Find, or harm the picture and its alternative text. Then Office saves a copy and we see what
# it keeps. Each program runs in its own job with a time limit, and only the Office process started here is closed if it hangs.
# Usage: powershell -File scripts/office-ocr/check-office.ps1 -Dir <folder with ocr.docx, ocr.pptx and ocr.xlsx>
param([Parameter(Mandatory = $true)][string]$Dir, [int]$Limit = 120)
$Dir = (Resolve-Path $Dir).Path
$all = @()

function Run-Step($app, $proc, [scriptblock]$body) {
  $start = Get-Date
  $job = Start-Job -ScriptBlock $body -ArgumentList $Dir
  if (Wait-Job $job -Timeout $Limit) { $script:all += @(Receive-Job $job) }
  else {
    Stop-Job $job
    $script:all += [pscustomobject]@{ Comprobacion = "${app}: no respondió en $Limit s"; Resultado = 'FALLA'; Detalle = '' }
    Get-Process $proc -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $start } | ForEach-Object { Stop-Process -Id $_.Id -Force }
  }
  Remove-Job $job -Force
}

$common = {
  function Rec($name, $ok, $detail) { [pscustomobject]@{ Comprobacion = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALLA' }); Detalle = $detail } }
  function Keeps($file, $marker) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($file); try { foreach ($e in $z.Entries) { if ($e.FullName -match '^customXml/[^/]+\.xml$') { $r = New-Object IO.StreamReader($e.Open()); $t = $r.ReadToEnd(); $r.Dispose(); if ($t -match $marker) { return $e.FullName } } }; return $null } finally { $z.Dispose() } }
  function Parts($file) { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($file); try { @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() } }
}

Run-Step 'Word' 'WINWORD' ([scriptblock]::Create('param($Dir)' + "`n" + $common.ToString() + @'
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false; $word.DisplayAlerts = 0
  $d = $word.Documents.Open((Join-Path $Dir 'ocr.docx'), $false, $true)
  $text = $d.Content.Text
  Rec 'Word: abre el .docx con el texto de la imagen sin avisos' $true "párrafos: $($d.Paragraphs.Count)"
  Rec 'Word: el texto del documento no incluye el de la imagen' (-not ($text -match 'Factura|4821|pagar')) ($text.Trim() -replace "[
]+", ' | ')
  $found = $d.Content.Find.Execute('Factura')
  Rec 'Word: Buscar «Factura» no encuentra el texto de la imagen (Word no busca dentro de imágenes)' (-not $found) "encontrado: $found"
  $alt = $d.InlineShapes.Item(1).AlternativeText
  Rec 'Word: la imagen sigue ahí con su texto alternativo' (($d.InlineShapes.Count -eq 1) -and ($alt -eq 'Una factura')) "imágenes: $($d.InlineShapes.Count); alt: '$alt'"
  $d.Close($false)
  $word.Quit()
} catch { Rec 'Word: error' $false $_.Exception.Message; try { $word.Quit() } catch {} }
'@))

# what Word keeps when it saves a copy (its own program, so the copy is made apart from the checks above: asking for the text first made the save wait for ever here)
Run-Step 'Word (guardar)' 'WINWORD' ([scriptblock]::Create('param($Dir)' + "`n" + $common.ToString() + @'
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false; $word.DisplayAlerts = 0
  $d = $word.Documents.Open((Join-Path $Dir 'ocr.docx'), $false, $true)
  $copy = Join-Path $Dir 'ocr-guardado-por-word.docx'
  if (Test-Path $copy) { Remove-Item $copy -Force }
  # by reference: with plain arguments the save waited for ever when the script ran in a child process
  $name = [ref]([string]$copy); $fmt = [ref]16
  $d.SaveAs2($name, $fmt)
  $d.Close($false)
  $word.Quit()
  $p = Parts $copy
  Rec 'Word: al guardar una copia la imagen se conserva' (@($p | Where-Object { $_ -match '^word/media/' }).Count -ge 1) (($p | Where-Object { $_ -match 'media|customXml' }) -join ', ')
  $k = Keeps $copy 'urn:suitenova:ocr:1.*Factura'
  Rec 'Word: al guardar, la parte con el texto leído se conserva (con otro nombre) y Nova la reconoce por dentro' ([bool]$k) "parte en la copia de Word: $k"
} catch { Rec 'Word (guardar): error' $false $_.Exception.Message; try { $word.Quit() } catch {} }
'@))

Run-Step 'PowerPoint' 'POWERPNT' ([scriptblock]::Create('param($Dir)' + "`n" + $common.ToString() + @'
try {
  $pp = New-Object -ComObject PowerPoint.Application
  $pres = $pp.Presentations.Open((Join-Path $Dir 'ocr.pptx'), -1, 0, 0)
  $txt = ''; $pics = 0
  foreach ($sl in $pres.Slides) { foreach ($sh in $sl.Shapes) { if ($sh.HasTextFrame) { $txt += $sh.TextFrame.TextRange.Text + ' ' }; if ($sh.Type -eq 13) { $pics++ } } }
  Rec 'PowerPoint: abre el .pptx con el texto de la imagen sin avisos' $true "diapositivas: $($pres.Slides.Count)"
  Rec 'PowerPoint: el texto de las diapositivas no incluye el de la imagen' (-not ($txt -match 'Factura|4821|pagar')) ($txt.Trim())
  Rec 'PowerPoint: la imagen sigue ahí' ($pics -ge 1) "imágenes: $pics"
  $copy = Join-Path $Dir 'ocr-guardado-por-powerpoint.pptx'
  if (Test-Path $copy) { Remove-Item $copy -Force }
  $pres.SaveCopyAs($copy)
  $pres.Close()
  $p = Parts $copy
  Rec 'PowerPoint: al guardar una copia la imagen se conserva' (@($p | Where-Object { $_ -match '^ppt/media/' }).Count -ge 1) (($p | Where-Object { $_ -match 'media|customXml' }) -join ', ')
  $k = Keeps $copy 'urn:suitenova:ocr:1.*Factura'
  Rec 'PowerPoint: al guardar, la parte con el texto leído se conserva (con otro nombre)' ([bool]$k) "parte en la copia de PowerPoint: $k"
  $pp.Quit()
} catch { Rec 'PowerPoint: error' $false $_.Exception.Message; try { $pp.Quit() } catch {} }
'@))

Run-Step 'Excel' 'EXCEL' ([scriptblock]::Create('param($Dir)' + "`n" + $common.ToString() + @'
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false
  $wb = $xl.Workbooks.Open((Join-Path $Dir 'ocr.xlsx'), 0, $true)
  $ws = $wb.Worksheets.Item(1)
  Rec 'Excel: abre el .xlsx con el texto de la imagen sin avisos' $true "hojas: $($wb.Worksheets.Count)"
  $a1 = [string]$ws.Range('A1').Value2
  $hit = $ws.Cells.Find('Factura')
  Rec 'Excel: las celdas no incluyen el texto de la imagen y Buscar no lo encuentra' (($a1 -eq 'Total del mes') -and ($null -eq $hit)) "A1='$a1'; usado: $($ws.UsedRange.Address()); Buscar «Factura»: $(if ($hit) { $hit.Address() } else { 'nada' })"
  Rec 'Excel: la imagen sigue ahí' ($ws.Shapes.Count -ge 1) "formas: $($ws.Shapes.Count)"
  $copy = Join-Path $Dir 'ocr-guardado-por-excel.xlsx'
  if (Test-Path $copy) { Remove-Item $copy -Force }
  $wb.SaveCopyAs($copy)
  $wb.Close($false)
  $p = Parts $copy
  Rec 'Excel: al guardar una copia la imagen se conserva' (@($p | Where-Object { $_ -match '^xl/media/' }).Count -ge 1) (($p | Where-Object { $_ -match 'media|customXml' }) -join ', ')
  $k = Keeps $copy 'urn:suitenova:calc:1.*Factura'
  Rec 'Excel: al guardar, la parte propia con el texto leído se conserva' ([bool]$k) "parte en la copia de Excel: $k"
  $xl.Quit()
} catch { Rec 'Excel: error' $false $_.Exception.Message; try { $xl.Quit() } catch {} }
'@))

$all | Select-Object Comprobacion, Resultado, Detalle | Format-Table -AutoSize -Wrap | Out-String -Width 250
if (@($all | Where-Object { $_.Resultado -eq 'FALLA' }).Count) { exit 1 }
