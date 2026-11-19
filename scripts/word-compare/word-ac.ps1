# Pregunta a Word real por la autocorrección: vuelca AutoCorrect.Entries y escribe cada caso con TypeText (con la autocorrección que Word aplica al teclear).
param([string]$Cases = "$PSScriptRoot\words-ac.json", [string]$Out = "$PSScriptRoot\word-ac-out.json")
$items = Get-Content $Cases -Raw -Encoding UTF8 | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $true
Add-Type -AssemblyName System.Windows.Forms
$sh = New-Object -ComObject WScript.Shell
function Esc([string]$t){ $o=''; foreach($c in $t.ToCharArray()){ if('+^%~(){}[]'.Contains($c)){ $o+='{'+$c+'}' } else { $o+=$c } }; $o }
$word.DisplayAlerts = 0
$res = @()
$entries = @()
try {
  $ac = $word.AutoCorrect
  foreach ($e in $ac.Entries) { $entries += [pscustomobject]@{ name = [string]$e.Name; value = [string]$e.Value } }
  $opts = [pscustomobject]@{ replaceText = $ac.ReplaceText; capSentences = $ac.CorrectSentenceCaps; twoInitial = $ac.CorrectInitialCaps; quotes = $word.Options.AutoFormatAsYouTypeReplaceQuotes; ordinals = $word.Options.AutoFormatAsYouTypeReplaceOrdinals; fractions = $word.Options.AutoFormatAsYouTypeReplaceFractions; dashes = $word.Options.AutoFormatAsYouTypeReplaceSymbols }
  $items = @($items[1]) + @($items); $first = $true
  foreach ($it in $items) {
    $doc = $word.Documents.Add()
    $err = ''; $text = ''
    try {
      $lid = $(if ($it.lang -eq 'en') { 1033 } else { 3082 })
      $word.Selection.LanguageID = $lid
      $word.Selection.NoProofing = 0
      $word.Activate(); [void]$sh.AppActivate($word.Caption); Start-Sleep -Milliseconds 300
      $word.Selection.TypeText('')
      foreach($ch in $it.text.ToCharArray()){ [System.Windows.Forms.SendKeys]::SendWait((Esc ([string]$ch))); Start-Sleep -Milliseconds 25 }
      Start-Sleep -Milliseconds 200
      $text = $doc.Content.Text
    } catch { $err = $_.Exception.Message }
    if ($first) { $first = $false; $doc.Close([ref]0); continue }
    $res += [pscustomobject]@{ lang = $it.lang; typed = $it.text; word = $text.TrimEnd("`r", "`n"); error = $err }
    $doc.Close([ref]0)
  }
} finally {
  $word.Quit([ref]0)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
[pscustomobject]@{ options = $opts; entries = $entries; cases = $res } | ConvertTo-Json -Depth 5 | Set-Content $Out -Encoding UTF8
"$($entries.Count) entradas, $($res.Count) casos"
