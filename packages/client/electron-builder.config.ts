import type {Configuration} from 'electron-builder';

const config: Configuration = {
  appId: 'com.rapid.app',
  productName: 'Rapid',
  directories: {
    output: 'dist-electron',
  },
  files: ['out/**/*', 'package.json'],
  npmRebuild: false,
  mac: {
    category: 'public.app-category.productivity',
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
    ],
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  linux: {
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
