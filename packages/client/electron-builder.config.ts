import type {Configuration} from 'electron-builder';
import {desktopAppId} from './electron/desktopAppId';

const sqliteModulePaths = [
  'node_modules/better-sqlite3-multiple-ciphers/**',
  'node_modules/.pnpm/better-sqlite3-multiple-ciphers@*/node_modules/better-sqlite3-multiple-ciphers/**',
];
const generatedSqliteNativePath = '.generated/electron-native/**';

const config: Configuration = {
  appId: desktopAppId,
  productName: 'Tearleads',
  directories: {
    output: 'dist-electron',
  },
  files: [
    'out/**/*',
    'build/icons/**/*',
    'package.json',
    generatedSqliteNativePath,
    ...sqliteModulePaths,
  ],
  asarUnpack: [...sqliteModulePaths, generatedSqliteNativePath],
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
    notarize: process.env.CI === 'true',
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
