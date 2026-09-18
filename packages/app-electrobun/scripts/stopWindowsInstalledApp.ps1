param([Parameter(Mandatory = $true)][string]$AppDirectory)

$ErrorActionPreference = "Stop"
$prefix = [System.IO.Path]::GetFullPath($AppDirectory).TrimEnd('\') + '\'
function Get-InstalledProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

$deadline = (Get-Date).AddSeconds(60)
$candidates = @()
do {
    $candidates = @(Get-InstalledProcesses)
    if ($candidates.Count -gt 0) { break }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if ($candidates.Count -eq 0) { throw "The Windows installer did not launch its installed app." }

$deadline = (Get-Date).AddSeconds(30)
$closed = $false
do {
    foreach ($candidate in @(Get-InstalledProcesses)) {
        $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if ($null -ne $process -and $process.MainWindowHandle -ne 0) {
            if ($process.CloseMainWindow()) { $closed = $true }
        }
    }
    Start-Sleep -Milliseconds 200
    $remaining = @(Get-InstalledProcesses)
    if ($remaining.Count -eq 0 -and $closed) { exit 0 }
} while ((Get-Date) -lt $deadline)

foreach ($candidate in $remaining) {
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue
}
throw "The app launched by the Windows installer did not close gracefully."
