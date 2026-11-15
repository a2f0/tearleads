package com.tearleads.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LocalNetworkAccessTest {

  private static final int ANDROID_16 = 36;
  private static final int ANDROID_17 = 37;

  @Test
  public void debugBuildOnAndroid17RequestsUntilGranted() {
    assertTrue(LocalNetworkAccess.shouldRequest(true, ANDROID_17, false));
    assertFalse(LocalNetworkAccess.shouldRequest(true, ANDROID_17, true));
  }

  @Test
  public void releaseBuildsNeverRequest() {
    assertFalse(LocalNetworkAccess.shouldRequest(false, ANDROID_17, false));
  }

  @Test
  public void olderPlatformsKeepImplicitLocalNetworkAccess() {
    assertFalse(LocalNetworkAccess.shouldRequest(true, ANDROID_16, false));
  }
}
