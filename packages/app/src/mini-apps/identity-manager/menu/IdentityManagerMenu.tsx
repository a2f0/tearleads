import { MiniAppSectionNavigation } from "../../../components/mini-app/MiniAppSectionNavigation";
import type { IdentityManagerView } from "../routes";
import { IDENTITY_MANAGER_SECTIONS } from "../sections";

export function IdentityManagerMenu({
  setView,
}: {
  setView: (view: IdentityManagerView) => void;
}) {
  return (
    <MiniAppSectionNavigation
      ariaLabel="Identity Manager sections"
      sections={IDENTITY_MANAGER_SECTIONS}
      setView={setView}
      variant="menu"
    />
  );
}
