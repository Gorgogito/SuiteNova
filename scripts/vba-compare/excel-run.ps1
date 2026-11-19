# Runs scripts/vba-compare/corpus.vba in real Excel (VBA) and writes the results to excel-out.json.
# It needs "Trust access to the VBA project object model": the script turns it on for the current user only while it runs
# and puts the registry back as it was (the value did not exist = off), even if something fails.
# A snippet that stops Excel with a dialog (a compile error, say) is detected by a watchdog that closes only the Excel this script started.
param([string]$Corpus = "$PSScriptRoot\corpus.vba", [string]$Out = "$PSScriptRoot\excel-out.json", [int]$Seconds = 20)

Add-Type -Namespace Nova -Name Win -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'
$key = 'HKCU:\Software\Microsoft\Office\16.0\Excel\Security'
$had = $null
if (Test-Path $key) { $had = (Get-ItemProperty $key -ErrorAction SilentlyContinue).AccessVBOM } else { New-Item -Path $key -Force | Out-Null }
Set-ItemProperty -Path $key -Name AccessVBOM -Value 1 -Type DWord

function Start-Excel {
  $x = New-Object -ComObject Excel.Application
  $x.Visible = $false
  $x.DisplayAlerts = $false
  $procId = [uint32]0
  [void][Nova.Win]::GetWindowThreadProcessId([System.IntPtr]$x.Hwnd, [ref]$procId)
  return @{ app = $x; pid = [int]$procId }
}

$ex = $null
try {
  $text = Get-Content -Raw -Encoding UTF8 $Corpus
  $items = @()
  foreach ($chunk in ($text -split "(?m)^'#### ")) {
    if (-not $chunk.Trim()) { continue }
    $nl = $chunk.IndexOf("`n")
    $items += [pscustomobject]@{ id = $chunk.Substring(0, $nl).Trim(); code = $chunk.Substring($nl + 1) }
  }
  $ex = Start-Excel
  $wb = $ex.app.Workbooks.Add()
  $info = @{ version = $ex.app.Version; decimal = $ex.app.International(3); culture = (Get-Culture).Name }
  $results = @()
  $i = 0
  foreach ($it in $items) {
    $i++
    $name = "M$i"
    $value = $null; $err = $null
    # the wrapper turns a run-time error of the snippet into a text instead of a dialog
    $code = $it.code.Replace("`r`n", "`n").TrimEnd() + "`n`nFunction RunT() As String`n    On Error GoTo e`n    RunT = T()`n    Exit Function`ne:`n    RunT = ""#ERROR "" & Err.Number`nEnd Function`n"
    $watch = Start-Job -ArgumentList $ex.pid, $Seconds -ScriptBlock { param($p, $s) Start-Sleep $s; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    try {
      $mod = $wb.VBProject.VBComponents.Add(1)
      $mod.Name = $name
      $mod.CodeModule.AddFromString($code.Replace("`n", "`r`n"))
      $value = [string]$ex.app.Run("$name.RunT")
    } catch {
      $err = $_.Exception.Message
    }
    Stop-Job $watch -ErrorAction SilentlyContinue; Remove-Job $watch -Force -ErrorAction SilentlyContinue
    if (-not (Get-Process -Id $ex.pid -ErrorAction SilentlyContinue)) {
      # Excel was closed by the watchdog: the snippet blocked it
      $err = 'BLOQUEO: Excel esperó una respuesta (error de compilación o de ejecución con diálogo)'
      $ex = Start-Excel
      $wb = $ex.app.Workbooks.Add()
    }
    $results += [pscustomobject]@{ id = $it.id; value = $value; error = $err }
  }
  $info.results = $results
  ([pscustomobject]$info) | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $Out
  $wb.Close($false)
}
finally {
  if ($ex) { try { $ex.app.Quit() } catch { } ; if (Get-Process -Id $ex.pid -ErrorAction SilentlyContinue) { Stop-Process -Id $ex.pid -Force -ErrorAction SilentlyContinue } }
  if ($null -eq $had) { Remove-ItemProperty -Path $key -Name AccessVBOM -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $key -Name AccessVBOM -Value $had -Type DWord }
}
Write-Output "listo: $Out"
