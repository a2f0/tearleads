import { AppWindow } from "../AppWindow";
import { Notes } from "./Notes";
import { NotesProvider } from "./NotesProvider";

export function NotesApp() {
  return (
    <AppWindow Provider={NotesProvider}>
      <Notes />
    </AppWindow>
  );
}
