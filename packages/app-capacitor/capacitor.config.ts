import type { CapacitorConfig } from "@capacitor/cli";

const { NATIVE_RELEASE_TIER } = process.env;
const nativeReleaseTier = (NATIVE_RELEASE_TIER ?? "production")
  .trim()
  .toLowerCase();
if (nativeReleaseTier !== "production" && nativeReleaseTier !== "staging") {
  throw new Error(
    `Unknown NATIVE_RELEASE_TIER=${JSON.stringify(nativeReleaseTier)}. Expected production or staging.`,
  );
}
const isStagingRelease = nativeReleaseTier === "staging";
const appId = isStagingRelease
  ? "com.tearleads.staging.app"
  : "com.tearleads.app";

const config: CapacitorConfig = {
  appId,
  appName: isStagingRelease ? "TL Staging" : "Tearleads",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    // Route the WebView's fetch/XMLHttpRequest through the native HTTP stack
    // (URLSession on iOS, OkHttp on Android) on EVERY build, debug and release.
    //
    // Why always-on: Capacitor serves the app from the custom-scheme origin
    // `https://localhost`, and the iOS WKWebView's own cross-origin `fetch` from
    // that origin fails outright — every API request to https://api.tearleads.com
    // throws "Load failed" (a network-layer TypeError), even though the server's
    // CORS/TLS are correct (verified: preflight + actual responses carry
    // `access-control-allow-origin: https://localhost`; TLS 1.3). That is exactly
    // the class of WKWebView cross-origin defect CapacitorHttp exists to sidestep:
    // native requests are not subject to the WebView's CORS machinery at all.
    //
    // This was previously enabled only in debug (which is why the app worked when
    // run from Xcode but the TestFlight/release build reported the device offline
    // and could not register, log in, sync, or open the events socket). Same-origin
    // requests to the local `https://localhost` bundle assets (wasm/worker) keep
    // using the WebView and are unaffected — proven by debug builds, which already
    // ran with this on. Blob byte downloads read a streaming response body, which
    // the native bridge buffers instead of streaming; that path is made resilient
    // in packages/api-client/src/routes/blobs/get.ts so it works under CapacitorHttp.
    // The events WebSocket is a separate `new WebSocket` connection and is not
    // affected by this fetch/XHR patch.
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: true,
      androidIsEncryption: true,
      iosKeychainPrefix: appId,
      iosBiometric: {
        biometricAuth: false,
      },
      androidBiometric: {
        biometricAuth: false,
      },
    },
  },
};

export default config;
