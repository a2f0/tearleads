import {
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type PropsWithChildren,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { CurrentWindowProvider } from "./CurrentWindowContext";
import { useWindowGeometryMenu } from "./useWindowFit";
import { useWindowGeometry } from "./useWindowGeometry";
import { useFocusWindowOnShow } from "./useWindowKeyboardGeometry";
import { WindowBody } from "./WindowBody";
import { WindowMenuBar, type WindowMenuItem } from "./WindowMenuBar";
import {
  useWindowFileMenuItems,
  useWindowViewMenuItems,
  WindowMenuProvider,
} from "./WindowMenuContext";
import { WindowResizeHandles } from "./WindowResizeHandle";
import {
  hasWindowSidebar,
  useWindowSidebar,
  WindowSidebarProvider,
} from "./WindowSidebarContext";
import {
  findTopWindow,
  useWindowActions as useWindowStateActions,
  useWindowStateData,
  type WindowEntry,
  type WindowPosition,
  type WindowSize,
} from "./WindowStateProvider";
import { WindowStatusBar } from "./WindowStatusBar";
import { WindowTitleBar } from "./WindowTitleBar";
import { WindowToolBar } from "./WindowToolBar";

// Wraps a window's content so the host can give it app-specific context (a
// route, an error boundary) without the window layer knowing about apps.
export type WindowContentBoundary = ComponentType<
  PropsWithChildren<{ entry: WindowEntry }>
>;

interface WindowProps {
  ContentBoundary?: WindowContentBoundary | undefined;
  /**
   * Whether the toolbar offers Back through the window's own route history,
   * reserving its row from the start (see `WindowToolBar`). Defaults to whether
   * the window has an `appId`. Pass false for an app that never routes, so its
   * window has no toolbar row until the app first registers toolbar actions.
   */
  historyBack?: boolean | undefined;
  windowId: string;
}

const WINDOW_STATUS_MESSAGE_DURATION_MS = 2500;

export function Window({
  ContentBoundary,
  historyBack,
  windowId,
}: WindowProps) {
  const { windowMap, windows } = useWindowStateData();
  const entry = windowMap.get(windowId);
  const isTop =
    findTopWindow(windows, (candidate) => !candidate.minimized)?.id ===
    windowId;

  if (!entry) return null;

  return (
    <WindowInner
      ContentBoundary={ContentBoundary}
      entry={entry}
      historyBack={historyBack ?? entry.appId !== undefined}
      isTop={isTop}
    />
  );
}

function useWindowActions(
  entry: WindowEntry,
  fileMenuItems: WindowMenuItem[],
  viewMenuItems: WindowMenuItem[],
  geometryMenuItems: WindowMenuItem[],
  hasSidebar: boolean,
) {
  const { close, minimize, moveBackward, moveForward, toggleMaximize } =
    useWindowStateActions();
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [showSidebar, setShowSidebar] = useState(
    entry.initialShowSidebar ?? true,
  );
  const handleClose = useCallback(() => close(entry.id), [close, entry.id]);
  const handleMinimize = useCallback(
    () => minimize(entry.id),
    [entry.id, minimize],
  );
  const handleMoveForward = useCallback(
    () => moveForward(entry.id),
    [entry.id, moveForward],
  );
  const handleMoveBackward = useCallback(
    () => moveBackward(entry.id),
    [entry.id, moveBackward],
  );
  const handleMaximize = useCallback(
    () => toggleMaximize(entry.id),
    [entry.id, toggleMaximize],
  );
  const toggleStatusBar = useCallback(
    () => setShowStatusBar((previous) => !previous),
    [],
  );
  const toggleSidebar = useCallback(
    () => setShowSidebar((previous) => !previous),
    [],
  );
  const menus = useMemo(
    () => [
      {
        label: "File",
        items: [
          ...fileMenuItems,
          { id: "close", label: "Close", onClick: handleClose },
        ],
      },
      {
        label: "View",
        items: [
          ...viewMenuItems,
          ...geometryMenuItems,
          {
            id: "toggle-status-bar",
            label: `${showStatusBar ? "Hide" : "Show"} Status Bar`,
            onClick: toggleStatusBar,
          },
          ...(hasSidebar
            ? [
                {
                  id: "toggle-sidebar",
                  label: `${showSidebar ? "Hide" : "Show"} Sidebar`,
                  onClick: toggleSidebar,
                },
              ]
            : []),
        ],
      },
    ],
    [
      geometryMenuItems,
      hasSidebar,
      handleClose,
      fileMenuItems,
      showSidebar,
      showStatusBar,
      toggleSidebar,
      toggleStatusBar,
      viewMenuItems,
    ],
  );

  return {
    handleClose,
    handleMaximize,
    handleMinimize,
    handleMoveBackward,
    handleMoveForward,
    menus,
    showSidebar,
    showStatusBar,
  };
}

// The window paints with `--window-background`, which a background its content
// sets (see `useWindowBackground`) overrides inline.
interface WindowStyle extends CSSProperties {
  "--window-background"?: string | undefined;
}

function getWindowFrameStyle(
  maximized: boolean,
  position: WindowPosition | null,
  size: WindowSize | null,
  zIndex: number,
): CSSProperties {
  if (maximized) {
    return { top: 0, left: 0, width: "100%", height: "100%", zIndex };
  }
  if (!position) {
    // Hidden until laid out; a requested size applies already so the first
    // clamp measures the window at the size it will show.
    return {
      visibility: "hidden",
      zIndex,
      ...(size ? { width: size.width, height: size.height } : {}),
    };
  }

  return {
    left: position.x,
    top: position.y,
    zIndex,
    ...(size ? { width: size.width, height: size.height } : {}),
  };
}

function getWindowStyle(
  maximized: boolean,
  position: WindowPosition | null,
  size: WindowSize | null,
  zIndex: number,
  background: string | undefined,
): WindowStyle {
  return {
    ...getWindowFrameStyle(maximized, position, size, zIndex),
    "--window-background": background,
  };
}

function useWindowStatusMessage() {
  const [statusText, setStatusText] = useState("");
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStatusMessage = useCallback((message: string) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusText(message);
    statusTimeoutRef.current = setTimeout(() => {
      setStatusText("");
      statusTimeoutRef.current = null;
    }, WINDOW_STATUS_MESSAGE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  return { showStatusMessage, statusText };
}

// Refcounted so overlapping overlays (one closing as another opens) never leave
// the row hidden, and never flash it back for a frame between the two.
function useWindowToolbarSuppression() {
  const [suppressionCount, setSuppressionCount] = useState(0);
  const suppressToolbar = useCallback(() => {
    setSuppressionCount((count) => count + 1);
    return () => setSuppressionCount((count) => Math.max(0, count - 1));
  }, []);

  return { suppressToolbar, toolbarSuppressed: suppressionCount > 0 };
}

interface WindowInnerProps {
  ContentBoundary?: WindowContentBoundary | undefined;
  entry: WindowEntry;
  historyBack: boolean;
  // Whether this is the foremost visible window, the one that takes focus.
  isTop: boolean;
}

function WindowInner({
  ContentBoundary,
  entry,
  historyBack,
  isTop,
}: WindowInnerProps) {
  return (
    <WindowMenuProvider>
      <WindowSidebarProvider>
        <WindowInnerContent
          ContentBoundary={ContentBoundary}
          entry={entry}
          historyBack={historyBack}
          isTop={isTop}
        />
      </WindowSidebarProvider>
    </WindowMenuProvider>
  );
}

// The bars above the body: title, menus, and the toolbar row a full-pane overlay
// can stand down (see `useWindowToolbarSuppression`).
function WindowChrome({
  actions,
  entry,
  historyBack,
  onGoBack,
  onPointerDown,
  titleId,
  toolbarSuppressed,
}: {
  actions: ReturnType<typeof useWindowActions>;
  entry: WindowEntry;
  historyBack: boolean;
  onGoBack: () => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  titleId: string;
  toolbarSuppressed: boolean;
}) {
  return (
    <>
      <WindowTitleBar
        title={entry.title}
        titleId={titleId}
        onPointerDown={onPointerDown}
        onMinimize={actions.handleMinimize}
        onMaximize={actions.handleMaximize}
        onClose={actions.handleClose}
        onMoveForward={actions.handleMoveForward}
        onMoveBackward={actions.handleMoveBackward}
      />
      <WindowMenuBar menus={actions.menus} />
      {!toolbarSuppressed && (
        <WindowToolBar
          canGoBack={(entry.routeHistory?.length ?? 0) > 0}
          showHistoryBack={historyBack}
          onGoBack={onGoBack}
        />
      )}
    </>
  );
}

// Handlers on the window root: its Back caret, raising it on any press inside,
// and keeping background context menus from opening under window-local ones.
function useWindowRootHandlers(windowId: string) {
  // The toolbar renders above the route boundary, so the window's own Back stack
  // is threaded in from here rather than read from context.
  const { bringToFront, goBackRoute } = useWindowStateActions();
  const handleGoBack = useCallback(() => {
    goBackRoute(windowId);
  }, [windowId, goBackRoute]);
  const handleWindowPointerDown = useCallback(() => {
    bringToFront(windowId);
  }, [bringToFront, windowId]);
  const handleWindowContextMenu = useCallback((event: ReactMouseEvent) => {
    // Keep background pane context menus from opening underneath window-local menus.
    event.stopPropagation();
  }, []);
  const windowContextMenuTrapProps: Pick<
    HTMLAttributes<HTMLElement>,
    "onContextMenu"
  > = {
    onContextMenu: handleWindowContextMenu,
  };

  return { handleGoBack, handleWindowPointerDown, windowContextMenuTrapProps };
}

function WindowInnerContent({
  ContentBoundary,
  entry,
  historyBack,
  isTop,
}: WindowInnerProps) {
  const { maximized, minimized, zIndex, component: Component } = entry;
  const windowRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const [background, setBackground] = useState<string | undefined>();
  const fileMenuItems = useWindowFileMenuItems();
  const viewMenuItems = useWindowViewMenuItems();
  const { sidebar } = useWindowSidebar();
  const hasSidebar = hasWindowSidebar(sidebar);
  const {
    handlePointerDown,
    handleResizePointerDown,
    position,
    size,
    ...stepped
  } = useWindowGeometry(entry, maximized, windowRef);
  const { showStatusMessage, statusText } = useWindowStatusMessage();
  const { contentFit, geometryMenuItems } = useWindowGeometryMenu(
    entry,
    stepped,
    { overlayHost, windowRef },
    showStatusMessage,
  );
  const actions = useWindowActions(
    entry,
    fileMenuItems,
    viewMenuItems,
    geometryMenuItems,
    hasSidebar,
  );
  // A maximized window fills its surface without a laid-out position.
  useFocusWindowOnShow(windowRef, {
    isTop,
    shown: !minimized && (maximized || position !== null),
  });
  const { suppressToolbar, toolbarSuppressed } = useWindowToolbarSuppression();
  const { handleGoBack, handleWindowPointerDown, windowContextMenuTrapProps } =
    useWindowRootHandlers(entry.id);
  const style = getWindowStyle(maximized, position, size, zIndex, background);

  if (minimized) {
    return null;
  }

  // A section labelled by its title is a region landmark. Windows are
  // non-modal and freely arranged, so they are not dialogs; hosts keep that
  // role for the modals they open inside a window.
  return (
    <section
      ref={windowRef}
      aria-labelledby={titleId}
      className={maximized ? "window window--maximized" : "window"}
      tabIndex={-1}
      {...windowContextMenuTrapProps}
      onPointerDownCapture={handleWindowPointerDown}
      style={style}
    >
      <WindowChrome
        actions={actions}
        entry={entry}
        historyBack={historyBack}
        onGoBack={handleGoBack}
        onPointerDown={handlePointerDown}
        titleId={titleId}
        toolbarSuppressed={toolbarSuppressed}
      />
      <CurrentWindowProvider
        close={actions.handleClose}
        id={entry.id}
        overlayHost={overlayHost}
        setBackground={setBackground}
        {...contentFit}
        showStatusMessage={showStatusMessage}
        suppressToolbar={suppressToolbar}
      >
        <WindowBodyWithSidebar
          overlayHostRef={setOverlayHost}
          showSidebar={actions.showSidebar}
        >
          {ContentBoundary ? (
            <ContentBoundary entry={entry}>
              {Component && <Component />}
            </ContentBoundary>
          ) : (
            Component && <Component />
          )}
        </WindowBodyWithSidebar>
      </CurrentWindowProvider>
      <WindowStatusBar text={statusText} visible={actions.showStatusBar} />
      {!maximized && (
        <WindowResizeHandles
          handleResizePointerDown={handleResizePointerDown}
        />
      )}
    </section>
  );
}

function WindowBodyWithSidebar({
  showSidebar,
  overlayHostRef,
  children,
}: PropsWithChildren<{
  overlayHostRef: (element: HTMLDivElement | null) => void;
  showSidebar: boolean;
}>) {
  const { sidebar } = useWindowSidebar();
  const hasSidebar = hasWindowSidebar(sidebar);

  return (
    <WindowBody
      contentRef={overlayHostRef}
      showSidebar={showSidebar && hasSidebar}
      sidebar={sidebar}
    >
      {children}
    </WindowBody>
  );
}
