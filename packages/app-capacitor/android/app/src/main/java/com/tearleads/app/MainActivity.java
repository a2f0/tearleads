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
    registerPlugin(PasswordKeychainPlugin.class);
    super.onCreate(savedInstanceState);
    requestDebugLocalNetworkAccess();
  }

  // Denial leaves the app usable offline; the development API stays unreachable.
  private void requestDebugLocalNetworkAccess() {
    boolean granted =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.CINNAMON_BUN &&
      checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED;
    if (!LocalNetworkAccess.shouldRequest(BuildConfig.DEBUG, Build.VERSION.SDK_INT, granted)) {
      return;
    }
    registerForActivityResult(new ActivityResultContracts.RequestPermission(), result -> {}).launch(
      Manifest.permission.ACCESS_LOCAL_NETWORK
    );
  }
}
