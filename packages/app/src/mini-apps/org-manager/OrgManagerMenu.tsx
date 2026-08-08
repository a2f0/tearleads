import { MiniAppSectionNavigation } from "../../components/mini-app/MiniAppSectionNavigation";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";
import { ORG_MANAGER_SECTIONS } from "./sections";

/**
 * The compact/mobile home screen: a top-level list of the org-manager sections
 * (the same set the sidebar shows on wide layouts). Tapping a row drills into
 * that section; the routed app-bar back button returns here. Rendered only when
 * the model reports `showCompactMenu`.
 */
export function OrgManagerMenu({
  setView,
}: {
  setView: (view: OrgManagerView) => void;
}) {
  return (
    <MiniAppSectionNavigation
      ariaLabel={ORG_MANAGER_LABELS.menuNavLabel}
      sections={ORG_MANAGER_SECTIONS}
      setView={setView}
      variant="menu"
    />
  );
}
