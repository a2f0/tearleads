import { useCallback, useMemo, useState } from "react";
import {
  useLauncherNavigationActions,
  useLauncherNavigationState,
} from "../launcher/LauncherNavigationProvider";
import { isLauncherAppId } from "../launcher/launcherDefinition";
import { useContextMenuState } from "../menu/useContextMenuState";
import { DesktopIcon } from "./DesktopIcon";
import { DesktopIconMenu, type DesktopIconMenuItem } from "./DesktopIconMenu";
import { resolveDesktopIconPositions } from "./desktopState";
import {
  createMemoryDesktopStateStorage,
  type DesktopStateStorage,
} from "./desktopStateStorage";
import type { DesktopIconSize } from "./useDesktopIconDrag";
import { useDesktopIconSelection } from "./useDesktopIconSelection";
import { useDesktopIconState } from "./useDesktopIconState";
import { useDesktopSurface } from "./useDesktopSurface";
import "./DesktopIcons.css";

export interface DesktopIconsProps<AppId extends string = string> {
  /** The launcher apps to show, in their default grid order. */
  appIds: ReadonlyArray<AppId>;
  /** The icon list's accessible name. Defaults to "Desktop". */
  label?: string | undefined;
  /** Extra context-menu items for an icon, shown below Open. */
  menuItems?:
    | ((appId: AppId) => ReadonlyArray<DesktopIconMenuItem>)
    | undefined;
  /** Opens an app. Defaults to the launcher's `openMiniApp`. */
  onOpen?: ((appId: AppId) => void) | undefined;
  /**
   * Where the icon positions persist. Without one they last as long as the
   * component. Keep the adapter stable: a new one reloads the layout.
   */
  storage?: DesktopStateStorage | undefined;
}

// An icon's box at most (DesktopIcons.css), for keeping a stored position on
// a surface smaller than the one it was saved on.
const DESKTOP_ICON_SIZE: DesktopIconSize = { height: 88, width: 80 };

const NO_MENU_ITEMS: ReadonlyArray<DesktopIconMenuItem> = [];

/**
 * Launcher apps as icons on the windowed desktop, behind its windows. Drag an
 * icon to move it; double-click it, or press Enter, to open its app;
 * right-click it for its menu. Positions persist through `storage`.
 *
 * Render it inside a {@link LauncherNavigationProvider}, as the first child of
 * the positioned surface the windows lay out on.
 */
export function DesktopIcons<AppId extends string>({
  appIds,
  label = "Desktop",
  menuItems,
  onOpen,
  storage,
}: DesktopIconsProps<AppId>) {
  const { definition } = useLauncherNavigationState();
  const { openMiniApp } = useLauncherNavigationActions();
  const [memoryStorage] = useState(createMemoryDesktopStateStorage);
  const { icons, moveIcon } = useDesktopIconState(storage ?? memoryStorage);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const { clamp, surface } = useDesktopSurface(layer);
  const shownIds = useMemo(
    () => appIds.filter((appId) => isLauncherAppId(definition, appId)),
    [appIds, definition],
  );
  const { selected, setSelected, step, tabbableId } = useDesktopIconSelection(
    layer,
    shownIds,
  );
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<AppId>({ onOpen: setSelected });
  const positions = useMemo(
    () => resolveDesktopIconPositions(shownIds, icons, surface.height),
    [icons, shownIds, surface.height],
  );
  const open = useCallback(
    (appId: AppId) => (onOpen ? onOpen(appId) : openMiniApp({ appId })),
    [onOpen, openMiniApp],
  );

  const menuAppId = contextMenu?.id;
  const menuApp = menuAppId === undefined ? null : definition.apps[menuAppId];
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      className="desktop-icons"
      ref={setLayer}
      role="listbox"
    >
      {shownIds.map((appId) => {
        const app = definition.apps[appId];
        const position = positions[appId];
        return app && position ? (
          <DesktopIcon
            appId={appId}
            clamp={clamp}
            icon={app.icon}
            key={appId}
            onContextMenu={(event) => openContextMenu(event, appId)}
            onMove={(next) => moveIcon(appId, next)}
            onOpen={() => open(appId)}
            onSelect={() => setSelected(appId)}
            onStep={(direction) => step(appId, direction)}
            position={clamp(position, DESKTOP_ICON_SIZE)}
            selected={selected === appId}
            tabbable={tabbableId === appId}
            title={app.title}
          />
        ) : null;
      })}
      {contextMenu && menuAppId !== undefined && menuApp && (
        <DesktopIconMenu
          icon={menuApp.icon}
          items={menuItems?.(menuAppId) ?? NO_MENU_ITEMS}
          onClose={closeContextMenu}
          onOpen={() => open(menuAppId)}
          position={contextMenu.position}
        />
      )}
    </div>
  );
}
