import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import type { IdentityManagerView } from "../routes";
import { IDENTITY_MANAGER_SECTIONS } from "../sections";

export function IdentityManagerMenu({
  setView,
}: {
  setView: (view: IdentityManagerView) => void;
}) {
  return (
    <nav
      aria-label="Identity Manager sections"
      className="identity-manager-menu"
    >
      {IDENTITY_MANAGER_SECTIONS.map(({ icon: SectionIcon, label, view }) => (
        <MiniAppRowButton
          className="identity-manager-menu-row"
          key={view}
          onClick={() => setView(view)}
        >
          <SectionIcon
            aria-hidden
            className="identity-manager-menu-icon"
            size={20}
          />
          <MiniAppRowText>{label}</MiniAppRowText>
          <CaretRightIcon
            aria-hidden
            className="identity-manager-menu-caret"
            size={16}
          />
        </MiniAppRowButton>
      ))}
    </nav>
  );
}
