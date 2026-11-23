# Runs the cases of casos.json in the real Word (Find.Execute) and writes what it found to resultados.json.
# Usage: powershell -File scripts/office-find/word-find.ps1 -Dir <folder with casos.json>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'casos.json') | ConvertFrom-Json
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
    $f.Text = [string]$c.query
    $f.Forward = $true
    $f.Wrap = 0
    $f.MatchCase = [bool]$c.matchCase
    $f.MatchWholeWord = [bool]$c.whole
    $f.MatchWildcards = [bool]$c.wild
    $found = New-Object System.Collections.ArrayList
    $guard = 0
    try {
      while ($f.Execute() -and $guard -lt 100) {
        [void]$found.Add($r.Text)
        $guard++
        $r.Collapse(0)
      }
    } catch {
      $found = New-Object System.Collections.ArrayList
      [void]$found.Add('<error>')
    }
    [void]$results.Add(@{ name = $c.name; found = @($found) })
  }
  @{ results = $results } | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding UTF8 (Join-Path $Dir 'resultados.json')
  $doc.Close($false)
  Write-Output "casos: $($results.Count)"
} finally {
  $word.Quit()
}
