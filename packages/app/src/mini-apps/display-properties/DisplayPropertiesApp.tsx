import { DisplayProperties } from "@tearleads/windowing";
import { AppWindow } from "../AppWindow";

// The windowing package's display settings: the desktop's wallpaper and the
// color theme. It reads the app-wide providers in Layout, so it needs no
// identity or database and opens from the pane's desktop menu at any time.
export function DisplayPropertiesApp() {
  return (
    <AppWindow>
      <DisplayProperties />
    </AppWindow>
  );
}
