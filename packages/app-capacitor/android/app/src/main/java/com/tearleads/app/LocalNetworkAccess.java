package com.tearleads.app;

import android.os.Build;

/**
 * Debug builds reach the development API on the host (10.0.2.2 from the emulator, the host's LAN
 * address from a device). Android 17 blocks local network traffic for apps targeting API 37 until
 * the user grants ACCESS_LOCAL_NETWORK, which only debug builds declare.
 */
final class LocalNetworkAccess {

  private LocalNetworkAccess() {}

  static boolean shouldRequest(boolean debugBuild, int sdkInt, boolean granted) {
    return debugBuild && sdkInt >= Build.VERSION_CODES.CINNAMON_BUN && !granted;
  }
}
