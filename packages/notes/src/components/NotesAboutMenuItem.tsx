import { AboutMenuItem } from '@tearleads/ui';
import notesPackageJson from '@tearleads/notes/package.json';

export function NotesAboutMenuItem() {
  return <AboutMenuItem appName="Notes" version={notesPackageJson.version} />;
}
