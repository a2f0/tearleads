import {
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  useMemo,
  useRef,
} from "react";
import { MiniAppRowActionsButton } from "../../../components/mini-app/MiniAppTable";
import { useRegisteredWindowSidebar } from "../../../components/window/WindowSidebarContext";
import { useRoutedLayoutActive } from "../../../navigation/useRoutedLayoutActive";

/** Presentation switches shared by the mini-app list sidebars and list homes. */
export interface MiniAppListPresentation {
  // Bleed the list to the screen edges on the mobile list home (the narrow
  // sidebar stays inset).
  bleed?: boolean | undefined;
  // Draw divider lines between entries (the mobile list home; the narrow
  // sidebar leaves them off).
  divided?: boolean | undefined;
  rowHeight?: number | undefined;
  // Render a trailing kebab that opens the row's context menu (the mobile list
  // home; the sidebar relies on right-click / long-press).
  showActions?: boolean | undefined;
  showMetadata?: boolean | undefined;
}

// True when a right-click landed on blank list space (frame padding, virtual
// spacers) rather than on a row, so the surface-level "area" menu may open.
function isAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
  rowSelector: string,
): boolean {
  return (
    !(event.target instanceof Element) || !event.target.closest(rowSelector)
  );
}

/** onContextMenu handler that forwards blank-space right-clicks to the area menu. */
export function createAreaContextMenuHandler(
  rowSelector: string,
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void,
): (event: MouseEvent<HTMLElement>) => void {
  return (event) => {
    if (
      event.defaultPrevented ||
      !isAreaContextMenuTarget(event, rowSelector)
    ) {
      return;
    }

    handleAreaContextMenu(event);
  };
}

const MINI_APP_ROW_ACTIONS_LABEL_PREFIX = "Actions for";

/** Trailing kebab that opens the row's context menu without selecting the row. */
export function MiniAppRowActionsKebab(params: {
  openContextMenu: (event: MouseEvent<HTMLElement>) => void;
  rowName: string;
}) {
  const label = `${MINI_APP_ROW_ACTIONS_LABEL_PREFIX} ${params.rowName}`;
  function open(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    params.openContextMenu(event);
  }

  return (
    <MiniAppRowActionsButton
      aria-label={label}
      onClick={open}
      onContextMenu={open}
      title={label}
    />
  );
}

function shallowPropsEqual(a: object, b: object): boolean {
  const aKeys = Object.keys(a);
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => Object.is(Reflect.get(a, key), Reflect.get(b, key)))
  );
}

// Same shape every render, so re-pointing the ref during render is idempotent.
function useShallowStableProps<Props extends object>(props: Props): Props {
  const propsRef = useRef(props);
  if (!shallowPropsEqual(propsRef.current, props)) {
    propsRef.current = props;
  }
  return propsRef.current;
}

/**
 * Registers a mini-app's list sidebar with the window chrome.
 *
 * Touch layouts (phone + tablet) have no right-click, so `showActions`
 * surfaces the row kebab in the sidebar rail too; the mobile list-home shows
 * its own kebab.
 *
 * Registering re-renders the window shell, so the sidebar element must stay
 * referentially stable across unrelated re-renders: the props are
 * value-compared before the element is rebuilt.
 */
export function useMiniAppSidebarPanel<Props extends object>(params: {
  Sidebar: ComponentType<Props & { showActions: boolean }>;
  props: Props;
  setSidebar: (sidebar: ReactNode) => void;
}): void {
  const { Sidebar, props, setSidebar } = params;
  const showActions = useRoutedLayoutActive();
  const stableProps = useShallowStableProps(props);
  const sidebar = useMemo(
    () => <Sidebar {...stableProps} showActions={showActions} />,
    [Sidebar, stableProps, showActions],
  );
  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
