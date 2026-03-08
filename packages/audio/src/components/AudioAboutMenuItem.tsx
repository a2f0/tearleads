import { AboutMenuItem } from '@tearleads/ui';
import audioPackageJson from '@tearleads/audio/package.json';

export function AudioAboutMenuItem() {
  return <AboutMenuItem appName="Audio" version={audioPackageJson.version} />;
}
