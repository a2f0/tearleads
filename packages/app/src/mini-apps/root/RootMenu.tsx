import { MiniAppSectionNavigation } from "../../components/mini-app/MiniAppSectionNavigation";
import type { RootView } from "./routes";
import { ROOT_SECTIONS } from "./sections";

export function RootMenu({ setView }: { setView: (view: RootView) => void }) {
  return (
    <MiniAppSectionNavigation
      ariaLabel="Root sections"
      sections={ROOT_SECTIONS}
      setView={setView}
      variant="menu"
    />
  );
}
