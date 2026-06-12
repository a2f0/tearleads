import type { CapacitorConfig } from "@capacitor/cli";

interface CapacitorBuildEnv {
  readonly CAPACITOR_BUILD_CONFIGURATION?: string | undefined;
  readonly [key: string]: string | undefined;
}

const RELEASE_BUILD_PATTERN = /release/i;

export function getCapacitorBuildConfiguration(
  env: CapacitorBuildEnv = process.env,
): string {
  return env.CAPACITOR_BUILD_CONFIGURATION ?? "Debug";
}

export function isCapacitorReleaseBuild(
  env: CapacitorBuildEnv = process.env,
): boolean {
  return RELEASE_BUILD_PATTERN.test(getCapacitorBuildConfiguration(env));
}

export function isCapacitorHttpEnabled(
  env: CapacitorBuildEnv = process.env,
): boolean {
  return !isCapacitorReleaseBuild(env);
}

const config: CapacitorConfig = {
  appId: "com.tearleads.app",
  appName: "Tearleads",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    CapacitorHttp: {
      enabled: isCapacitorHttpEnabled(),
    },
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: true,
      androidIsEncryption: true,
      iosKeychainPrefix: "com.tearleads.app",
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
