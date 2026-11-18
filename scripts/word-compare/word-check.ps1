# Pasa el corpus por Word real (COM) y guarda lo que marca. Solo lee SpellingErrors y GrammarErrors; no llama a CheckGrammar.
param([string]$Corpus = "$PSScriptRoot\corpus.json", [string]$Out = "$PSScriptRoot\word-out.json")
$items = Get-Content $Corpus -Raw -Encoding UTF8 | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$res = @()
try {
  $doc = $word.Documents.Add()
  $word.Options.CheckGrammarAsYouType = $true
  $word.Options.CheckSpellingAsYouType = $true
  foreach ($it in $items) {
    $r = $doc.Content
    $r.Text = $it.text
    $r = $doc.Content
    $r.LanguageID = $(if ($it.lang -eq 'en') { 1033 } else { 3082 })
    $r.NoProofing = 0
    $doc.Content.Select() | Out-Null
    $sp = @(); $gr = @()
    $n = $doc.Content.SpellingErrors.Count
    for ($i = 1; $i -le $n; $i++) { $sp += $doc.Content.SpellingErrors.Item($i).Text }
    $m = $doc.Content.GrammarErrors.Count
    for ($i = 1; $i -le $m; $i++) { $gr += $doc.Content.GrammarErrors.Item($i).Text }
    $res += [pscustomobject]@{ lang = $it.lang; text = $it.text; spelling = $sp; grammar = $gr }
  }
  $doc.Close([ref]0)
} finally {
  $word.Quit([ref]0)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
$res | ConvertTo-Json -Depth 4 | Set-Content $Out -Encoding UTF8
"$($res.Count) frases"
