import { useMiniAppSectionSidebarPanel } from "../../components/mini-app/MiniAppSectionNavigation";
import type { RootView } from "./routes";
import { ROOT_SECTIONS } from "./sections";

export function useRootSidebarPanel({
  setView,
  view,
}: {
  setView: (view: RootView) => void;
  view: RootView;
}) {
  useMiniAppSectionSidebarPanel({
    sections: ROOT_SECTIONS,
    selectedView: view,
    setView,
  });
}
