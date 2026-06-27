import {
  APP_HOST_PROFILES,
  type AppHostProfile,
} from "../../src/host/AppHostConfig";

/**
 * Returns a copy of `profile` with the boot-time identity autopilot disabled
 * (no auto key generation, no auto registration). Tests that drive the manual
 * identity flow — clicking "Generate Key Pair" / "Register" or asserting the
 * unbooted boot prompt — build their host config from this so the autopilot does
 * not provision an identity out from under them. New tests that exercise the
 * autopilot opt back in by passing an unmodified profile.
 */
export function withManualIdentity(profile: AppHostProfile): AppHostProfile {
  return {
    ...profile,
    features: {
      ...profile.features,
      autoGenerateIdentity: false,
      autoRegisterIdentity: false,
    },
  };
}

/**
 * Resolves the host profile for a test host config: the given profile (or the
 * default `app` profile), with the identity autopilot disabled unless the test
 * opts in via `autoProvisionIdentity`. Centralizes the manual-vs-auto choice so
 * the test host-config builders stay small.
 */
export function resolveTestHostProfile(options: {
  readonly autoProvisionIdentity?: boolean | undefined;
  readonly profile?: AppHostProfile | undefined;
}): AppHostProfile {
  const baseProfile = options.profile ?? APP_HOST_PROFILES.app;
  return options.autoProvisionIdentity
    ? baseProfile
    : withManualIdentity(baseProfile);
}
