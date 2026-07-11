import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
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
    <nav
      aria-label={ORG_MANAGER_LABELS.menuNavLabel}
      className="org-manager-menu"
    >
      {ORG_MANAGER_SECTIONS.map(({ icon: SectionIcon, label, view }) => (
        <MiniAppRowButton
          className="org-manager-menu-row"
          key={view}
          onClick={() => setView(view)}
        >
          <SectionIcon
            aria-hidden
            className="org-manager-menu-icon"
            size={20}
          />
          <MiniAppRowText>{label}</MiniAppRowText>
          <CaretRightIcon
            aria-hidden
            className="org-manager-menu-caret"
            size={16}
          />
        </MiniAppRowButton>
      ))}
    </nav>
  );
}
