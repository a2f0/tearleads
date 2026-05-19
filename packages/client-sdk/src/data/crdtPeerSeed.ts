export function getScopedPeerSeed(scope: string): string {
  const deviceSeedKey = `tearleads.${scope}.device-seed`;
  const sessionPeerSeedKey = `tearleads.${scope}.session-peer-seed`;

  try {
    const existingDeviceSeed = window.localStorage.getItem(deviceSeedKey);
    const deviceSeed = existingDeviceSeed ?? crypto.randomUUID();
    if (!existingDeviceSeed) {
      window.localStorage.setItem(deviceSeedKey, deviceSeed);
    }

    const existingSessionSeed =
      window.sessionStorage.getItem(sessionPeerSeedKey);
    const sessionSeed = existingSessionSeed ?? crypto.randomUUID();
    if (!existingSessionSeed) {
      window.sessionStorage.setItem(sessionPeerSeedKey, sessionSeed);
    }

    return `${deviceSeed}:${sessionSeed}`;
  } catch {
    return crypto.randomUUID();
  }
}
