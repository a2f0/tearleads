export interface PlatformInfo {
  arch: string;
  ext: string;
}

export interface Release {
  version: string;
  date: string;
  platforms: {
    macos: PlatformInfo;
    windows: PlatformInfo;
    linux: PlatformInfo;
  };
}

export interface ReleasesData {
  releases: Release[];
}
