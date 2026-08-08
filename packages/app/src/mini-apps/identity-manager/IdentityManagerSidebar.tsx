import { useMiniAppSectionSidebarPanel } from "../../components/mini-app/MiniAppSectionNavigation";
import type { IdentityManagerView } from "./routes";
import { IDENTITY_MANAGER_SECTIONS } from "./sections";

export function useIdentityManagerSidebarPanel({
  setView,
  view,
}: {
  setView: (view: IdentityManagerView) => void;
  view: IdentityManagerView;
}) {
  useMiniAppSectionSidebarPanel({
    sections: IDENTITY_MANAGER_SECTIONS,
    selectedView: view,
    setView,
  });
}
