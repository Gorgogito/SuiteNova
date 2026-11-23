# Asks the real Word how it cuts each paragraph of the corpus into sentences (`Range.Sentences`), to compare with the shared reader's rules.
# Runs in a job with a time limit; only the Word started here is closed if it hangs.
# Usage: powershell -File scripts/voice-compare/word-sentences.ps1 -Corpus corpus.json -Out word.json
param([Parameter(Mandatory = $true)][string]$Corpus, [Parameter(Mandatory = $true)][string]$Out, [int]$Limit = 150)
$Corpus = (Resolve-Path $Corpus).Path
$OutFull = [IO.Path]::GetFullPath($Out)
$start = Get-Date
$job = Start-Job -ArgumentList $Corpus, $OutFull -ScriptBlock {
  param($corpus, $out)
  $items = Get-Content $corpus -Raw -Encoding UTF8 | ConvertFrom-Json
  $w = New-Object -ComObject Word.Application
  $w.Visible = $false; $w.DisplayAlerts = 0
  $res = @()
  try {
    $d = $w.Documents.Add()
    foreach ($t in $items) {
      $d.Content.Text = ($t -replace "`n", "`r")
      $en = $t -match '\b(the|and|said|left|Then|what|See|Wait)\b'
      $d.Content.LanguageID = $(if ($en) { 1033 } else { 3082 })
      $sent = @()
      for ($i = 1; $i -le $d.Sentences.Count; $i++) { $s = $d.Sentences.Item($i).Text.Trim(); if ($s) { $sent += $s } }
      $res += , $sent
    }
    $d.Close($false)
  } finally { $w.Quit() }
  ($res | ConvertTo-Json -Depth 4 -Compress) | Set-Content -Path $out -Encoding UTF8
}
if (Wait-Job $job -Timeout $Limit) { Receive-Job $job | Out-Null; "listo: $OutFull" }
else {
  Stop-Job $job
  Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $start } | ForEach-Object { Stop-Process -Id $_.Id -Force }
  "Word no respondió en $Limit s"; exit 1
}
Remove-Job $job -Force
