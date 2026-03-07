import notesPackageJson from '@tearleads/notes/package.json';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

export function NotesAboutMenuItem() {
  return <AboutMenuItem appName="Notes" version={notesPackageJson.version} />;
}
