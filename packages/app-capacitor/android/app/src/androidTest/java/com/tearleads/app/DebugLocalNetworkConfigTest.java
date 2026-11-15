package com.tearleads.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.os.Build;
import android.security.NetworkSecurityPolicy;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Debug builds must be able to reach the development API on the emulator host. */
@RunWith(AndroidJUnit4.class)
public class DebugLocalNetworkConfigTest {

  @Test
  public void debugBuildDeclaresRuntimeLocalNetworkPermission() throws Exception {
    assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.CINNAMON_BUN);
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    PackageManager packageManager = context.getPackageManager();
    PackageInfo packageInfo = packageManager.getPackageInfo(
      context.getPackageName(),
      PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS)
    );

    assertTrue(Arrays.asList(packageInfo.requestedPermissions).contains(Manifest.permission.ACCESS_LOCAL_NETWORK));
    PermissionInfo permission = packageManager.getPermissionInfo(Manifest.permission.ACCESS_LOCAL_NETWORK, 0);
    assertEquals(PermissionInfo.PROTECTION_DANGEROUS, permission.getProtection());
  }

  @Test
  public void debugBuildAllowsCleartextOnlyToEmulatorHost() {
    NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();

    assertTrue(policy.isCleartextTrafficPermitted("10.0.2.2"));
    assertFalse(policy.isCleartextTrafficPermitted("api.tearleads.com"));
  }
}
