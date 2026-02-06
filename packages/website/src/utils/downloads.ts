import type { PlatformInfo } from '../types/releases';

type Platform = 'macos' | 'windows' | 'linux';

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
  const domain = import.meta.env.PUBLIC_DOWNLOAD_DOMAIN;
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
