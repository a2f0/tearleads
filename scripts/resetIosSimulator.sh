#!/bin/sh
set -eu

DEVICE="iPhone 16 Pro"

echo "Resetting iOS simulator: $DEVICE"

# Get the simulator UDID
UDID=$(xcrun simctl list devices available | grep "$DEVICE" | head -1 | grep -oE '[A-F0-9-]{36}')

if [ -z "$UDID" ]; then
    echo "Error: Could not find simulator '$DEVICE'"
    exit 1
fi

# Shutdown simulator if running
xcrun simctl shutdown "$UDID" 2>/dev/null || true

# Erase the simulator (wipes all data)
echo "Erasing simulator data..."
xcrun simctl erase "$UDID"

# Boot the simulator
echo "Booting simulator..."
xcrun simctl boot "$UDID"

# Wait for boot to complete
echo "Waiting for simulator to boot..."
while [ "$(xcrun simctl list devices | grep "$UDID" | grep -c "Booted")" -eq 0 ]; do
    sleep 1
done

echo "Simulator reset complete and ready"
