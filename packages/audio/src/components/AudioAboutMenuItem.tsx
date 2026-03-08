import audioPackageJson from '@tearleads/audio/package.json';
import { AboutMenuItem } from '@tearleads/ui';

export function AudioAboutMenuItem() {
  return <AboutMenuItem appName="Audio" version={audioPackageJson.version} />;
}
