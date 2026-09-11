param([Parameter(Mandatory = $true)][int]$AppProcessId)

$ErrorActionPreference = "Stop"
$processIds = [System.Collections.Generic.List[int]]::new()
$processIds.Add($AppProcessId)
for ($index = 0; $index -lt $processIds.Count; $index++) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($processIds[$index])" |
        ForEach-Object { $processIds.Add([int]$_.ProcessId) }
}

$requestedClose = $false
foreach ($candidateId in $processIds) {
    $candidate = Get-Process -Id $candidateId -ErrorAction SilentlyContinue
    if ($null -ne $candidate -and $candidate.MainWindowHandle -ne 0) {
        if ($candidate.CloseMainWindow()) {
            Write-Output "Requested window close for process $candidateId."
            $requestedClose = $true
        }
    }
}

if (-not $requestedClose) {
    throw "No window in the app process tree accepted a close request."
}
