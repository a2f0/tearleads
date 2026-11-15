package com.tearleads.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RevenueCatPurchasePlugin.class);
    super.onCreate(savedInstanceState);
    requestDebugLocalNetworkAccess();
  }

  // Only debug builds declare ACCESS_LOCAL_NETWORK (src/debug/AndroidManifest.xml):
  // they reach the development API on the host, which Android 17 blocks for
  // apps targeting API 37 until the user grants local network access.
  private void requestDebugLocalNetworkAccess() {
    if (
      !BuildConfig.DEBUG ||
      Build.VERSION.SDK_INT < Build.VERSION_CODES.CINNAMON_BUN ||
      checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED
    ) {
      return;
    }
    registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {}).launch(
      Manifest.permission.ACCESS_LOCAL_NETWORK
    );
  }
}
