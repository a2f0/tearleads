param([Parameter(Mandatory = $true)][string]$AppDirectory)

$ErrorActionPreference = "Stop"
# Bun's temporary directory can use RUNNER~1 while CIM reports runneradmin.
# Expand both sides through Windows before comparing executable locations.
Add-Type @'
using System.Runtime.InteropServices;
using System.Text;
public static class InstalledAppPaths {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetLongPathName(string path, StringBuilder buffer, uint size);
    public static string Expand(string path) {
        var buffer = new StringBuilder(32768);
        uint size = GetLongPathName(path, buffer, (uint)buffer.Capacity);
        return size == 0 || size >= buffer.Capacity ? null : buffer.ToString();
    }
}
'@
$directory = [InstalledAppPaths]::Expand([System.IO.Path]::GetFullPath($AppDirectory))
if ([string]::IsNullOrEmpty($directory)) { throw "Cannot resolve the installed app directory." }
$prefix = $directory.TrimEnd('\') + '\'
function Get-InstalledProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        if (-not $_.ExecutablePath) { return $false }
        $path = [InstalledAppPaths]::Expand($_.ExecutablePath)
        $path -and $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

$deadline = (Get-Date).AddSeconds(60)
$candidates = @()
do {
    $candidates = @(Get-InstalledProcesses)
    if ($candidates.Count -gt 0) { break }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if ($candidates.Count -eq 0) {
    Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -like '*tearleads-cef-persistence-*'
    } | Select-Object ProcessId, Name, ExecutablePath | Format-List
    throw "The Windows installer did not launch its installed app."
}

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
    Write-Output "Installed process did not close: $($candidate.ProcessId) $($candidate.Name) $($candidate.ExecutablePath)"
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue
}
throw "The app launched by the Windows installer did not close gracefully."
