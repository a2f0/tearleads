import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import type { UserSession } from "@symcrypt/client-sdk";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";

export function SessionContextMenu({
  closeContextMenu,
  handleEndSession,
  mutatingSessionId,
  onOpenSessionDetail,
  position,
  session,
}: {
  closeContextMenu: () => void;
  handleEndSession: (session: UserSession) => Promise<void>;
  mutatingSessionId: string | null;
  onOpenSessionDetail: (sessionId: string) => void;
  position: MenuPosition | null;
  session: UserSession | null;
}) {
  if (!position || !session) {
    return null;
  }

  return (
    <Menu direction="down" position={position} onClose={closeContextMenu}>
      <MenuItem
        icon={InfoIcon}
        label="Get Info"
        onClick={() => {
          closeContextMenu();
          onOpenSessionDetail(session.id);
        }}
      />
      <MenuItem
        disabled={mutatingSessionId !== null}
        icon={SignOutIcon}
        label="Log Out Session"
        onClick={() => {
          closeContextMenu();
          void handleEndSession(session);
        }}
      />
    </Menu>
  );
}
