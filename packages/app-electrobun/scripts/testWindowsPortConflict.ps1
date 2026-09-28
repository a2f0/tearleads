$ErrorActionPreference = "Stop"

# Electrobun's native host transport starts its port search at 50000. Hold that
# port exclusively so the real app must select another port before opening CEF.
# Windows returns WSAEACCES for an exclusive listener or an excluded port; the
# 2.0.1 core reported that as Unexpected instead of continuing its port search.
# Pinned search range: https://github.com/blackboardsh/electrobun/blob/v2.0.2-beta.35/package/src/core/main.zig#L119-L120
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 50000)
$listener.ExclusiveAddressUse = $true
$previousExpectedPort = $env:TEARLEADS_TEST_BLOCKED_RPC_PORT
try {
    try {
        $listener.Start()
        Write-Output "Holding Electrobun host transport port 50000 exclusively."
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.NativeErrorCode -notin @(10013, 10048)) { throw }
        Write-Output "Port 50000 is already reserved or occupied ($($_.Exception.NativeErrorCode))."
    }

    $env:TEARLEADS_TEST_BLOCKED_RPC_PORT = "50000"
    & bun run --cwd "$PSScriptRoot/.." test:windows-persistence
    if ($LASTEXITCODE -ne 0) {
        & netsh interface ipv4 show excludedportrange protocol=tcp
        throw "Windows persistence failed with the first host transport port unavailable."
    }
} finally {
    $listener.Stop()
    $env:TEARLEADS_TEST_BLOCKED_RPC_PORT = $previousExpectedPort
}
