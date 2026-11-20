$ErrorActionPreference = 'Continue'
# Abre con Word, PowerPoint, Excel y Visio reales (COM) los archivos que crea `node scripts/real-pictures.mjs <carpeta>` y escribe lo que ven.
# Uso: pwsh scripts/real-pictures.ps1 -Dir <carpeta>
param([string]$Dir = $PSScriptRoot)
$d = $Dir
function Try-Do($name, [scriptblock]$b) { try { & $b } catch { Write-Output "$name ERROR: $($_.Exception.Message)" } }

Write-Output "=== WORD"
Try-Do 'word' {
  $w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0
  $doc = $w.Documents.Open("$d\imagen.docx", $false, $true)
  foreach ($s in $doc.InlineShapes) { $f = $s.PictureFormat; Write-Output ("inline type={0} w={1} h={2} alt='{3}' cropL={4} cropR={5} cropT={6} cropB={7} line={8}" -f $s.Type, $s.Width, $s.Height, $s.AlternativeText, $f.CropLeft, $f.CropRight, $f.CropTop, $f.CropBottom, $s.Line.Visible) }
  foreach ($s in $doc.Shapes) { $f = $s.PictureFormat; Write-Output ("shape type={0} w={1} h={2} alt='{3}' cropL={4} cropR={5} line={6} lw={7} rot={8} wrap={9}" -f $s.Type, $s.Width, $s.Height, $s.AlternativeText, $f.CropLeft, $f.CropRight, $s.Line.Visible, $s.Line.Weight, $s.Rotation, $s.WrapFormat.Type) }
  $doc.Close($false); $w.Quit()
}

Write-Output "=== POWERPOINT"
Try-Do 'ppt' {
  $p = New-Object -ComObject PowerPoint.Application
  $pr = $p.Presentations.Open("$d\imagen.pptx", $true, $false, $false)
  foreach ($s in $pr.Slides(1).Shapes) { $f = $s.PictureFormat; Write-Output ("shape type={0} L={1} T={2} w={3} h={4} rot={5} alt='{6}' cropL={7} cropR={8} bright={9} contrast={10} line={11} lw={12} autoshape={13}" -f $s.Type, $s.Left, $s.Top, $s.Width, $s.Height, $s.Rotation, $s.AlternativeText, $f.CropLeft, $f.CropRight, $f.Brightness, $f.Contrast, $s.Line.Visible, $s.Line.Weight, $s.AutoShapeType) }
  $pr.Close(); $p.Quit()
}

Write-Output "=== EXCEL"
Try-Do 'excel' {
  $x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false
  $wb = $x.Workbooks.Open("$d\imagen.xlsx", 0, $true)
  foreach ($s in $wb.Worksheets(1).Shapes) { $f = $s.PictureFormat; Write-Output ("shape '{0}' type={1} L={2} T={3} w={4} h={5} rot={6} alt='{7}' cropL={8} cropR={9} tl={10} br={11} placement={12} autoshape={13} line={14} lw={15}" -f $s.Name, $s.Type, $s.Left, $s.Top, $s.Width, $s.Height, $s.Rotation, $s.AlternativeText, $f.CropLeft, $f.CropRight, $s.TopLeftCell.Address($false, $false), $s.BottomRightCell.Address($false, $false), $s.Placement, $s.AutoShapeType, $s.Line.Visible, $s.Line.Weight) }
  $wb.Close($false); $x.Quit()
}

Write-Output "=== VISIO"
Try-Do 'visio' {
  $v = New-Object -ComObject Visio.Application; $v.Visible = $false
  $doc = $v.Documents.OpenEx("$d\imagen.vsdx", 4)
  foreach ($s in $doc.Pages(1).Shapes) { Write-Output ("shape id={0} name='{1}' type={2} pinX={3} pinY={4} w={5} h={6} text='{7}'" -f $s.ID, $s.Name, $s.Type, $s.CellsU('PinX').ResultIU, $s.CellsU('PinY').ResultIU, $s.CellsU('Width').ResultIU, $s.CellsU('Height').ResultIU, $s.Text) }
  $doc.Close(); $v.Quit()
}
