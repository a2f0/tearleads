import notesPackageJson from '@tearleads/app-notes/package.json';
import { AboutMenuItem } from '@tearleads/ui';

export function NotesAboutMenuItem() {
  return <AboutMenuItem appName="Notes" version={notesPackageJson.version} />;
}
