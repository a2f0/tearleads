import releasesJson from '../data/releases.json';
import type { PlatformInfo, Release, ReleasesData } from '../types/releases';

type Platform = 'macos' | 'windows' | 'linux';

export function isValidPlatformInfo(obj: unknown): obj is PlatformInfo {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as PlatformInfo).arch === 'string' &&
    typeof (obj as PlatformInfo).ext === 'string'
  );
}

export function isValidRelease(obj: unknown): obj is Release {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Release;
  return (
    typeof r.version === 'string' &&
    typeof r.date === 'string' &&
    typeof r.platforms === 'object' &&
    r.platforms !== null &&
    isValidPlatformInfo(r.platforms.macos) &&
    isValidPlatformInfo(r.platforms.windows) &&
    isValidPlatformInfo(r.platforms.linux)
  );
}

/* v8 ignore start */
export function getReleases(): Release[] {
  const data = releasesJson as ReleasesData;
  if (!Array.isArray(data.releases)) {
    throw new Error('Invalid releases.json: expected releases array');
  }
  for (const release of data.releases) {
    if (!isValidRelease(release)) {
      throw new Error(
        `Invalid release entry in releases.json: ${JSON.stringify(release)}`
      );
    }
  }
  return data.releases;
}
/* v8 ignore stop */

function buildFilename(
  version: string,
  platform: Platform,
  platformInfo: PlatformInfo
): string {
  switch (platform) {
    case 'macos':
      return `Rapid-${version}-${platformInfo.arch}.${platformInfo.ext}`;
    case 'windows':
      return `Rapid-Setup-${version}.${platformInfo.ext}`;
    case 'linux':
      return `Rapid-${version}-x86_64.${platformInfo.ext}`;
  }
}

export function getDownloadUrl(
  version: string,
  platform: Platform,
  platformInfo: PlatformInfo
): string {
  const domain =
    import.meta.env.PUBLIC_DOWNLOAD_DOMAIN || 'download.example.com';
  const filename = buildFilename(version, platform, platformInfo);
  return `https://${domain}/desktop/${version}/${filename}`;
}

export function detectPlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes('mac') || userAgent.includes('mac')) {
    return 'macos';
  }
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'linux';
  }
  return null;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux'
};

export const PLATFORM_ICONS: Record<Platform, string> = {
  macos: 'apple',
  windows: 'windows',
  linux: 'linux'
};
