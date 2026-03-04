import emailPackageJson from '@tearleads/email/package.json';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

export function EmailAboutMenuItem() {
  return <AboutMenuItem appName="Email" version={emailPackageJson.version} />;
}
