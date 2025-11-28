import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tearleads.rapid',
  appName: 'Rapid',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
