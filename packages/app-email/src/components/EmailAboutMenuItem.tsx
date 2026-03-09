import emailPackageJson from '@tearleads/app-email/package.json';
import { AboutMenuItem } from '@tearleads/ui';

export function EmailAboutMenuItem() {
  return <AboutMenuItem appName="Email" version={emailPackageJson.version} />;
}
