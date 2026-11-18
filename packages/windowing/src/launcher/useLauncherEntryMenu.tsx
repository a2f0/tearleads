import type { MouseEvent } from "react";
import { DesktopIconMenu } from "../desktop/DesktopIconMenu";
import type { WindowingIcon } from "../icons/windowingIcon";
import { useContextMenuState } from "../menu/useContextMenuState";
import { useLongPress } from "../menu/useLongPress";

/** Secondary activation offers the same Open action as the entry itself. */
export function useLauncherEntryMenu(
  icon: WindowingIcon | undefined,
  onOpen: () => void,
) {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<null>();
  const longPress = useLongPress(true, { emulateRightClick: true });
  return {
    triggerProps: {
      ...longPress,
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.currentTarget.focus({ preventScroll: true });
        openContextMenu(event, null);
      },
    },
    menu: contextMenu && (
      <DesktopIconMenu
        icon={icon}
        items={[]}
        onClose={closeContextMenu}
        onOpen={onOpen}
        position={contextMenu.position}
      />
    ),
  };
}
