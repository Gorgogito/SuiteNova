# Pregunta a Word real (SynonymInfo) por los sinónimos de cada palabra de words-syn.json.
param([string]$Words = "$PSScriptRoot\words-syn.json", [string]$Out = "$PSScriptRoot\word-syn-out.json")
$items = Get-Content $Words -Raw -Encoding UTF8 | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$res = @()
try {
  foreach ($it in $items) {
    $lid = $(if ($it.lang -eq 'en') { 1033 } else { 3082 })
    $found = $false; $syn = @(); $err = ''
    try {
      $w = $it.word; $l = $lid
      $si = $word.SynonymInfo($w, [ref]$l)
      $found = [bool]$si.Found
      if ($found) {
        $ml = $si.MeaningList
        foreach ($m in $ml) { $mm = $m; foreach ($s in $si.SynonymList([ref]$mm)) { $syn += [string]$s } }
      }
    } catch { $err = $_.Exception.Message }
    $res += [pscustomobject]@{ lang = $it.lang; word = $it.word; found = $found; synonyms = ($syn | Select-Object -Unique); error = $err }
  }
} finally {
  $word.Quit([ref]0)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
$res | ConvertTo-Json -Depth 4 | Set-Content $Out -Encoding UTF8
"$($res.Count) palabras"
