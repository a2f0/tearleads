import { useMemo } from "react";
import { MiniAppSidebar } from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../../components/window/WindowSidebarContext";
import type { IdentityManagerView } from "./routes";
import { IDENTITY_MANAGER_SECTIONS } from "./sections";

function IdentityManagerSidebar({
  setView,
  view,
}: {
  setView: (view: IdentityManagerView) => void;
  view: IdentityManagerView;
}) {
  return (
    <MiniAppSidebar>
      {IDENTITY_MANAGER_SECTIONS.map(
        ({ icon: SectionIcon, label, view: sectionView }) => (
          <MiniAppRowButton
            key={sectionView}
            onClick={() => setView(sectionView)}
            selected={view === sectionView}
          >
            <SectionIcon
              aria-hidden
              className="identity-manager-sidebar-icon"
              size={20}
            />
            <MiniAppRowText>{label}</MiniAppRowText>
          </MiniAppRowButton>
        ),
      )}
    </MiniAppSidebar>
  );
}

export function useIdentityManagerSidebarPanel({
  setView,
  view,
}: {
  setView: (view: IdentityManagerView) => void;
  view: IdentityManagerView;
}) {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => <IdentityManagerSidebar setView={setView} view={view} />,
    [setView, view],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
