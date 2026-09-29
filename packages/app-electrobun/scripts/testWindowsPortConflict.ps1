$ErrorActionPreference = "Stop"

# Electrobun's native host transport starts its port search at 50000. Hold that
# port exclusively so the real app must select another port before opening CEF.
# The 2.0.1 core used SO_REUSEADDR and reported WSAEACCES as Unexpected.
# Pinned search range: https://github.com/blackboardsh/electrobun/blob/v2.0.2-beta.35/package/src/core/main.zig#L119-L120
# Old listener: https://github.com/blackboardsh/electrobun/blob/v2.0.1/package/src/core/main.zig#L1283
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 50000)
$listener.ExclusiveAddressUse = $true
$previousExpectedPort = $env:TEARLEADS_TEST_BLOCKED_RPC_PORT
$ownsPort = $false
try {
    try {
        $listener.Start()
        $ownsPort = $true
        Write-Output "Holding Electrobun host transport port 50000 exclusively."
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.NativeErrorCode -notin @(10013, 10048)) { throw }
        Write-Output "Port 50000 is already reserved or occupied ($($_.Exception.NativeErrorCode)); running persistence without the owned-conflict assertions."
    }

    $env:TEARLEADS_TEST_BLOCKED_RPC_PORT = $null
    if ($ownsPort) {
        # Exercise the old socket configuration against the conflict. This proves
        # the access-denied bind condition, not a full run of the old application.
        # https://learn.microsoft.com/en-us/windows/win32/winsock/using-so-reuseaddr-and-so-exclusiveaddruse
        $reuseProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 50000)
        $reuseProbe.ExclusiveAddressUse = $false
        $reuseProbe.Server.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
        try {
            try {
                $reuseProbe.Start()
                throw "SO_REUSEADDR unexpectedly bound the blocked host transport port."
            } catch [System.Net.Sockets.SocketException] {
                if ($_.Exception.NativeErrorCode -ne 10013) { throw }
                Write-Output "The old SO_REUSEADDR listener configuration fails with WSAEACCES (10013)."
            }
        } finally {
            $reuseProbe.Stop()
        }

        $env:TEARLEADS_TEST_BLOCKED_RPC_PORT = "50000"
    }
    & bun run --cwd "$PSScriptRoot/.." test:windows-persistence
    if ($LASTEXITCODE -ne 0) {
        & netsh interface ipv4 show excludedportrange protocol=tcp
        throw "Windows persistence failed (owned port-conflict fixture: $ownsPort)."
    }
} finally {
    $listener.Stop()
    $env:TEARLEADS_TEST_BLOCKED_RPC_PORT = $previousExpectedPort
}
