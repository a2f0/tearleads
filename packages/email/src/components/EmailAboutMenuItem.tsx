import { AboutMenuItem } from '@tearleads/ui';
import emailPackageJson from '@tearleads/email/package.json';

export function EmailAboutMenuItem() {
  return <AboutMenuItem appName="Email" version={emailPackageJson.version} />;
}
