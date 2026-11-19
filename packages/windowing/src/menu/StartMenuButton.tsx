import type { ComponentProps } from "react";
import { Menu } from "./Menu";
import { MenuItem } from "./MenuItem";
import { useContextMenuState } from "./useContextMenuState";
import { useLongPress } from "./useLongPress";

/** Both taskbars offer the host's Start menu settings on secondary click. */
export function StartMenuButton({
  onOpenSettings,
  ...button
}: ComponentProps<"button"> & { onOpenSettings?: (() => void) | undefined }) {
  const { contextMenu, openContextMenu, closeContextMenu } =
    useContextMenuState();
  const longPress = useLongPress(Boolean(onOpenSettings), {
    emulateRightClick: true,
  });

  return (
    <>
      <button
        {...button}
        {...longPress}
        type="button"
        onContextMenu={
          onOpenSettings && ((event) => openContextMenu(event, "settings"))
        }
      />
      {contextMenu && onOpenSettings && (
        <Menu position={contextMenu.position} onClose={closeContextMenu}>
          <MenuItem
            label="Start menu settings"
            onClick={() => {
              closeContextMenu();
              onOpenSettings();
            }}
          />
        </Menu>
      )}
    </>
  );
}
