import notesPackageJson from '@tearleads/notes/package.json';
import { AboutMenuItem } from '@tearleads/ui';

export function NotesAboutMenuItem() {
  return <AboutMenuItem appName="Notes" version={notesPackageJson.version} />;
}
