import type {Configuration} from 'electron-builder';
import {desktopAppId} from './electron/desktop-app-id';

const config: Configuration = {
  appId: desktopAppId,
  productName: 'Rapid',
  directories: {
    output: 'dist-electron',
  },
  files: ['out/**/*', 'build/icons/**/*', 'package.json'],
  npmRebuild: false,
  icon: 'build/icons/icon',
  mac: {
    icon: 'build/icons/icon.icns',
    category: 'public.app-category.productivity',
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
    ],
  },
  win: {
    icon: 'build/icons/icon.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  linux: {
    icon: 'build/icons/icon.png',
    category: 'Utility',
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
    ],
  },
};

export default config;
