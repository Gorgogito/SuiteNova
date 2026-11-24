# Makes the real Word, Excel and PowerPoint apply each theme of casos.json and reads back the 12 colours, the fonts, the tints of the colour gallery
# (Excel) and the theme1.xml that Word holds. Usage: powershell -File scripts/office-theme/office-theme.ps1 -Dir <folder with casos.json>
# Environment: NOVA_APPS=word,excel,ppt (which ones), NOVA_LIMIT=n (how many themes). Progress goes to progreso.log in the folder.
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$Dir = (Resolve-Path $Dir).Path
$log = Join-Path $Dir 'progreso.log'
Set-Content $log ''
function Log($m) { Add-Content $log $m }
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'casos.json') | ConvertFrom-Json
function Hex($bgr) { $r = $bgr -band 255; $g = ($bgr -shr 8) -band 255; $b = ($bgr -shr 16) -band 255; return ('#{0:x2}{1:x2}{2:x2}' -f $r, $g, $b) }
function SchemeColors($scheme) { $out = @(); for ($i = 1; $i -le 12; $i++) { $out += (Hex $scheme.Colors($i).RGB) }; return $out }
$apps = if ($env:NOVA_APPS) { $env:NOVA_APPS.Split(',') } else { @('word', 'excel', 'ppt') }
$limit = if ($env:NOVA_LIMIT) { [int]$env:NOVA_LIMIT } else { 1000 }
$results = New-Object System.Collections.ArrayList
$word = $null; $xl = $null; $pp = $null
try {
  if ($apps -contains 'word') { $word = New-Object -ComObject Word.Application; $word.Visible = $false; $word.DisplayAlerts = 0; Log 'word listo' }
  if ($apps -contains 'excel') { $xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false; Log 'excel listo' }
  if ($apps -contains 'ppt') { $pp = New-Object -ComObject PowerPoint.Application; Log 'ppt listo' }
  foreach ($c in ($cases.themes | Select-Object -First $limit)) {
    $file = Join-Path $Dir $c.file
    $r = @{ file = $c.file }
    if ($word) {
      $doc = $null
      try {
        Log "word $($c.file)"
        $doc = $word.Documents.Add()
        $doc.ApplyDocumentTheme($file)
        Log '  aplicado'
        $th = $doc.DocumentTheme
        $w = @{ colors = (SchemeColors $th.ThemeColorScheme); major = $th.ThemeFontScheme.MajorFont.Item(1).Name; minor = $th.ThemeFontScheme.MinorFont.Item(1).Name }
        Log '  leido'
        # the theme part that Word would save, without saving (WordOpenXML is the document as a flat package)
        $xml = $doc.WordOpenXML
        $m0 = [regex]::Match($xml, 'pkg:name="/word/theme/theme1.xml".*?</pkg:part>', 'Singleline')
        $cols = @()
        foreach ($s in 'dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink') {
          $m = [regex]::Match($m0.Value, "<a:$s>.*?(?:srgbClr val|lastClr)=""([0-9A-Fa-f]{6})""", 'Singleline')
          $cols += ('#' + $m.Groups[1].Value.ToLower())
        }
        $w.saved = @{ colors = $cols; effects = [regex]::Match($m0.Value, '<a:fmtScheme name="([^"]*)"').Groups[1].Value }
        Log '  paquete leido'
        $r.word = $w
      } catch { $r.word = @{ error = $_.Exception.Message }; Log ('  ERROR ' + $_.Exception.Message) }
      if ($doc) { try { $doc.Close($false) } catch {} }
    }
    if ($xl) {
      $wb = $null
      try {
        Log "excel $($c.file)"
        $wb = $xl.Workbooks.Add()
        $wb.ApplyTheme($file)
        $th = $wb.Theme
        $e = @{ colors = (SchemeColors $th.ThemeColorScheme); major = $th.ThemeFontScheme.MajorFont.Item(1).Name; minor = $th.ThemeFontScheme.MinorFont.Item(1).Name }
        $ws = $wb.Worksheets.Item(1)
        # XlThemeColor: Dark1 1, Light1 2, Dark2 3, Light2 4, Accent1-6 5-10; the columns are Background 1, Text 1, Background 2, Text 2, Accent 1-6
        $order = @(2, 1, 4, 3, 5, 6, 7, 8, 9, 10)
        $ts = @(@(0, -0.05, -0.15, -0.25, -0.35, -0.5), @(0, 0.5, 0.35, 0.25, 0.15, 0.05), @(0, -0.1, -0.25, -0.5, -0.75, -0.9), @(0, 0.8, 0.6, 0.4, -0.25, -0.5))
        $tints = @()
        for ($k = 0; $k -lt 10; $k++) {
          $t = if ($k -lt 4) { $ts[$k] } else { $ts[3] }
          $col = @()
          for ($j = 0; $j -lt 6; $j++) {
            $cell = $ws.Cells.Item($j + 1, $k + 1)
            $cell.Interior.ThemeColor = $order[$k]
            $cell.Interior.TintAndShade = $t[$j]
            $col += (Hex $cell.Interior.Color)
          }
          $tints += , $col
        }
        $e.tints = $tints
        $r.excel = $e
        Log '  excel leido'
      } catch { $r.excel = @{ error = $_.Exception.Message }; Log ('  ERROR ' + $_.Exception.Message) }
      if ($wb) { try { $wb.Close($false) } catch {} }
    }
    if ($pp) {
      $pres = $null
      try {
        Log "ppt $($c.file)"
        $pres = $pp.Presentations.Add(0)
        $th = $pres.SlideMaster.Theme
        $th.ThemeColorScheme.Load($file.Replace('.thmx', '-colores.xml'))
        $th.ThemeFontScheme.Load($file.Replace('.thmx', '-fuentes.xml'))
        $r.ppt = @{ colors = (SchemeColors $th.ThemeColorScheme); major = $th.ThemeFontScheme.MajorFont.Item(1).Name; minor = $th.ThemeFontScheme.MinorFont.Item(1).Name }
        Log '  ppt leido'
      } catch { $r.ppt = @{ error = $_.Exception.Message }; Log ('  ERROR ' + $_.Exception.Message) }
      if ($pres) { try { $pres.Close() } catch {} }
    }
    [void]$results.Add($r)
  }
  @{ themes = $results } | ConvertTo-Json -Depth 8 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'resultados.json')
  Write-Output "temas: $($results.Count)"
} finally {
  if ($word) { try { $word.Quit() } catch {} }
  if ($xl) { try { $xl.Quit() } catch {} }
  if ($pp) { try { $pp.Quit() } catch {} }
}
