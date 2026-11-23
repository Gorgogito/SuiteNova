# Runs the replacements of casos-reemplazo.json in the real Word (Find.Execute with Replace = wdReplaceAll) and writes the text left to resultados-reemplazo.json.
# Usage: powershell -File scripts/office-find/word-replace.ps1 -Dir <folder with casos-reemplazo.json>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'casos-reemplazo.json') | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Add()
  $results = New-Object System.Collections.ArrayList
  foreach ($c in $cases) {
    $doc.Content.Text = [string]$c.text
    $r = $doc.Content
    $f = $r.Find
    $f.ClearFormatting()
    $f.Replacement.ClearFormatting()
    $f.Text = [string]$c.query
    $f.Replacement.Text = [string]$c.rep
    $f.Forward = $true
    $f.Wrap = 0
    $f.MatchCase = [bool]$c.matchCase
    $f.MatchWildcards = [bool]$c.wild
    $out = ''
    try {
      [void]$f.Execute([string]$c.query, [bool]$c.matchCase, $false, [bool]$c.wild, $false, $false, $true, 0, $false, [string]$c.rep, 2)
      $out = $doc.Content.Text.TrimEnd("`r")
    } catch {
      $out = '<error>'
    }
    [void]$results.Add(@{ name = $c.name; text = $out })
  }
  @{ results = $results } | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'resultados-reemplazo.json')
  $doc.Close($false)
  Write-Output "casos: $($results.Count)"
} finally {
  $word.Quit()
}
