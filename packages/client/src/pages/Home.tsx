import {
  AppWindow,
  ExternalLink,
  LayoutGrid,
  Maximize2,
  Monitor,
  Square
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { navItems } from '@/components/Sidebar';
import { DisplayPropertiesWindow } from '@/components/settings/DisplayPropertiesWindow';
import { ContextMenu } from '@/components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from '@/components/ui/context-menu/ContextMenuItem';
import { DesktopBackground } from '@/components/ui/desktop-background';
import { MOBILE_BREAKPOINT } from '@/constants/breakpoints';
import {
  useWindowManager,
  type WindowType
} from '@/contexts/WindowManagerContext';
import { useSettings } from '@/db/SettingsProvider';
import type { DesktopIconDepthValue } from '@/db/user-settings';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTypedTranslation } from '@/i18n';
import { cn } from '@/lib/utils';

// AGENT GUARDRAIL: When adding a new path here, ensure parity with:
// - Sidebar.tsx WINDOW_PATHS mapping
// - WindowManagerContext.tsx WindowType union
// - WindowRenderer.tsx switch cases
export const PATH_TO_WINDOW_TYPE: Partial<Record<string, WindowType>> = {
  '/notes': 'notes',
  '/console': 'console',
  '/settings': 'settings',
  '/files': 'files',
  '/documents': 'documents',
  '/debug': 'debug',
  '/email': 'email',
  '/contacts': 'contacts',
  '/photos': 'photos',
  '/videos': 'videos',
  '/keychain': 'keychain',
  '/sqlite': 'sqlite',
  '/opfs': 'opfs',
  '/chat': 'chat',
  '/analytics': 'analytics',
  '/audio': 'audio',
  '/models': 'models',
  '/admin/redis': 'admin',
  '/admin/postgres': 'admin-postgres',
  '/cache-storage': 'cache-storage',
  '/local-storage': 'local-storage'
};

export const ICON_SIZE = 64;
const ICON_SIZE_MOBILE = 56;
export const GAP = 40;
const GAP_MOBILE = 28;
export const LABEL_HEIGHT = 16;
export const ICON_LABEL_GAP = 8;
const MOBILE_COLUMNS = 4;
export const ITEM_HEIGHT = ICON_SIZE + LABEL_HEIGHT + ICON_LABEL_GAP;
const ITEM_HEIGHT_MOBILE = ICON_SIZE_MOBILE + LABEL_HEIGHT + ICON_LABEL_GAP;
const STORAGE_KEY = 'desktop-icon-positions';
const MIN_SELECTION_DRAG_DISTANCE = 5;

type Position = { x: number; y: number };
type Positions = Record<string, Position>;

function getIconStyleClasses(
  isSettings: boolean,
  iconDepth?: DesktopIconDepthValue
) {
  const isDebossed = iconDepth === 'debossed';
  if (isDebossed) {
    return {
      iconBgClasses: isSettings
        ? 'bg-primary-foreground from-primary-foreground/60 to-primary-foreground'
        : 'bg-primary-foreground from-primary-foreground/80 to-primary-foreground',
      iconFgClass: isSettings ? 'text-muted-foreground' : 'text-primary'
    };
  }

  return {
    iconBgClasses: isSettings
      ? 'bg-muted-foreground from-muted-foreground/60 to-muted-foreground'
      : 'bg-primary from-primary/80 to-primary',
    iconFgClass: 'text-primary-foreground'
  };
}

function getItemsToArrange(
  items: typeof navItems,
  selectedPaths?: Set<string>
): typeof navItems {
  return selectedPaths && selectedPaths.size > 0
    ? items.filter((item) => selectedPaths.has(item.path))
    : items;
}

function sortItemsByLabel(
  items: typeof navItems,
  getLabel: (item: (typeof navItems)[number]) => string
): typeof navItems {
  return [...items].sort((a, b) =>
    getLabel(a).localeCompare(getLabel(b), undefined, { sensitivity: 'base' })
  );
}

function isElement(target: EventTarget | null): target is Element {
  return target !== null && target instanceof Element;
}

function positionsAreEqual(p1: Positions, p2: Positions): boolean {
  const keys1 = Object.keys(p1);
  const keys2 = Object.keys(p2);
  if (keys1.length !== keys2.length) {
    return false;
  }
  for (const key of keys1) {
    const pos1 = p1[key];
    const pos2 = p2[key];
    if (!pos1 || !pos2 || pos1.x !== pos2.x || pos1.y !== pos2.y) {
      return false;
    }
  }
  return true;
}

function constrainPosition(
  pos: Position,
  containerWidth: number,
  containerHeight: number,
  iconSize: number,
  labelHeight: number
): Position {
  const itemWidth = iconSize;
  const itemHeight = iconSize + labelHeight + ICON_LABEL_GAP;
  return {
    x: Math.max(0, Math.min(pos.x, containerWidth - itemWidth)),
    y: Math.max(0, Math.min(pos.y, containerHeight - itemHeight))
  };
}

function constrainAllPositions(
  positions: Positions,
  containerWidth: number,
  containerHeight: number,
  iconSize: number,
  labelHeight: number
): Positions {
  const constrained: Positions = {};
  for (const [key, pos] of Object.entries(positions)) {
    constrained[key] = constrainPosition(
      pos,
      containerWidth,
      containerHeight,
      iconSize,
      labelHeight
    );
  }
  return constrained;
}

function calculateGridPositions(
  items: typeof navItems,
  containerWidth: number,
  isMobile: boolean,
  selectedPaths?: Set<string>,
  currentPositions?: Positions
): Positions {
  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const gap = isMobile ? GAP_MOBILE : GAP;
  const itemWidth = iconSize + gap;
  const cols = Math.max(1, Math.floor(containerWidth / itemWidth));
  const totalWidth = cols * itemWidth - gap;
  const startX = (containerWidth - totalWidth) / 2;

  const itemsToArrange = getItemsToArrange(items, selectedPaths);
  const positions: Positions = currentPositions ? { ...currentPositions } : {};
  itemsToArrange.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions[item.path] = {
      x: startX + col * itemWidth,
      y: row * (isMobile ? ITEM_HEIGHT_MOBILE + gap : ITEM_HEIGHT + gap)
    };
  });
  return positions;
}

function calculateScatterPositions(
  items: typeof navItems,
  containerWidth: number,
  containerHeight: number,
  isMobile: boolean,
  selectedPaths?: Set<string>,
  currentPositions?: Positions
): Positions {
  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const itemHeightCalc = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const maxX = Math.max(0, containerWidth - iconSize);
  const maxY = Math.max(0, containerHeight - itemHeightCalc);

  const itemsToArrange = getItemsToArrange(items, selectedPaths);
  const positions: Positions = currentPositions ? { ...currentPositions } : {};
  itemsToArrange.forEach((item) => {
    positions[item.path] = {
      x: Math.floor(Math.random() * maxX),
      y: Math.floor(Math.random() * maxY)
    };
  });
  return positions;
}

function boxIntersectsIcon(
  box: { startX: number; startY: number; endX: number; endY: number },
  iconPos: Position,
  iconSize: number,
  itemHeight: number
): boolean {
  // Normalize box coordinates (handle dragging in any direction)
  const boxLeft = Math.min(box.startX, box.endX);
  const boxRight = Math.max(box.startX, box.endX);
  const boxTop = Math.min(box.startY, box.endY);
  const boxBottom = Math.max(box.startY, box.endY);

  // Icon bounding box
  const iconLeft = iconPos.x;
  const iconRight = iconPos.x + iconSize;
  const iconTop = iconPos.y;
  const iconBottom = iconPos.y + itemHeight;

  // Check for intersection
  return !(
    boxRight < iconLeft ||
    boxLeft > iconRight ||
    boxBottom < iconTop ||
    boxTop > iconBottom
  );
}

function calculateClusterPositions(
  items: typeof navItems,
  containerWidth: number,
  containerHeight: number,
  isMobile: boolean,
  selectedPaths?: Set<string>,
  currentPositions?: Positions,
  maxItemWidth?: number
): Positions {
  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const gap = isMobile ? GAP_MOBILE : GAP;
  const itemHeightCalc = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const clusterItemWidth = Math.max(iconSize, maxItemWidth ?? 0);
  const itemWidth = clusterItemWidth + gap;
  const itemHeightWithGap = itemHeightCalc + gap;

  const itemsToArrange = getItemsToArrange(items, selectedPaths);

  // Calculate grid dimensions for a square-ish arrangement
  const cols = Math.ceil(Math.sqrt(itemsToArrange.length));
  const rows = Math.ceil(itemsToArrange.length / cols);

  // Calculate total cluster dimensions
  const clusterWidth = cols * itemWidth - gap;
  const clusterHeight = rows * itemHeightWithGap - gap;

  // Center the cluster
  const startX = Math.max(0, (containerWidth - clusterWidth) / 2);
  const startY = Math.max(0, (containerHeight - clusterHeight) / 2);

  const positions: Positions = currentPositions ? { ...currentPositions } : {};
  itemsToArrange.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions[item.path] = {
      x: startX + col * itemWidth,
      y: startY + row * itemHeightWithGap
    };
  });
  return positions;
}

function getMaxIconButtonWidth(
  container: HTMLDivElement | null,
  paths: string[]
): number | null {
  if (!container || paths.length === 0) {
    return null;
  }

  const pathSet = new Set(paths);
  let maxWidth = 0;

  container
    .querySelectorAll<HTMLButtonElement>('button[data-icon-path]')
    .forEach((button) => {
      const path = button.dataset.iconPath;
      if (!path || !pathSet.has(path)) {
        return;
      }
      const measuredWidth =
        button.offsetWidth || button.getBoundingClientRect().width;
      if (measuredWidth > maxWidth) {
        maxWidth = measuredWidth;
      }
    });

  return maxWidth > 0 ? Math.ceil(maxWidth) : null;
}

export function Home() {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();
  const { openWindow } = useWindowManager();
  const { getSetting } = useSettings();

  // Memoize appItems to prevent new array reference on every render
  // which would cause the position calculation effect to run continuously
  const appItems = useMemo(
    () => navItems.filter((item) => item.path !== '/'),
    []
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Positions>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [iconContextMenu, setIconContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const [isDisplayPropertiesOpen, setIsDisplayPropertiesOpen] = useState(false);
  const isMobile = useIsMobile();
  const [selectedIcons, setSelectedIcons] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const isSelectingRef = useRef(false);

  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const itemHeight = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const gridTemplateColumns = `repeat(${MOBILE_COLUMNS}, minmax(0, 1fr))`;
  const iconDepth = getSetting('desktopIconDepth');
  const iconDepthClasses =
    iconDepth === 'debossed'
      ? 'bg-gradient-to-tl shadow-inner'
      : 'bg-gradient-to-br shadow-lg';

  useEffect(() => {
    const handleResize = () => {
      // Constrain positions to new viewport bounds (only if container has valid dimensions)
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        if (width > 0 && height > 0) {
          const currentIconSize =
            window.innerWidth < MOBILE_BREAKPOINT
              ? ICON_SIZE_MOBILE
              : ICON_SIZE;
          setPositions((prev) => {
            const constrained = constrainAllPositions(
              prev,
              width,
              height,
              currentIconSize,
              LABEL_HEIGHT
            );
            // Only update localStorage if positions actually changed
            if (!positionsAreEqual(constrained, prev)) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(constrained));
            }
            return constrained;
          });
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const savedPositions = JSON.parse(saved) as Positions;
          // Validate that all current app items have positions
          const allItemsHavePositions = appItems.every((item) => {
            const pos = savedPositions[item.path];
            return (
              pos && typeof pos.x === 'number' && typeof pos.y === 'number'
            );
          });
          if (allItemsHavePositions) {
            // Constrain saved positions to current viewport bounds (only if container has valid dimensions)
            if (width > 0 && height > 0) {
              const currentIconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
              const constrained = constrainAllPositions(
                savedPositions,
                width,
                height,
                currentIconSize,
                LABEL_HEIGHT
              );
              setPositions(constrained);
            } else {
              // Container not yet laid out, use saved positions as-is
              setPositions(savedPositions);
            }
            return;
          }
        } catch {
          // Invalid JSON, fall through to default grid
        }
      }
      setPositions(calculateGridPositions(appItems, width, isMobile));
    }
  }, [appItems, isMobile]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, path: string) => {
      if (isMobile) return; // Disable dragging on mobile
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = positions[path];
      if (!pos || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDragging(path);
      setHasDragged(false);
      setSelectedIcons(new Set()); // Clear selection when dragging an icon
      setDragOffset({
        x: e.clientX - rect.left - pos.x,
        y: e.clientY - rect.top - pos.y
      });
      if (isElement(e.target)) {
        e.target.setPointerCapture(e.pointerId);
      }
    },
    [positions, isMobile]
  );

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile) return;
      if (e.button !== 0) return;
      // Only start selection if clicking on the canvas itself, not an icon
      if (isElement(e.target) && e.target.closest('button')) return;
      if (!containerRef.current) return;

      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      isSelectingRef.current = true;
      setSelectionBox({ startX: x, startY: y, endX: x, endY: y });
      setSelectedIcons(new Set()); // Clear previous selection
    },
    [isMobile]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      // Handle selection box drawing
      if (isSelectingRef.current && selectionBox) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setSelectionBox((prev) =>
          prev ? { ...prev, endX: x, endY: y } : null
        );
        return;
      }

      // Handle icon dragging
      if (!dragging) return;
      setHasDragged(true);
      const newX = e.clientX - rect.left - dragOffset.x;
      const newY = e.clientY - rect.top - dragOffset.y;
      const constrained = constrainPosition(
        { x: newX, y: newY },
        rect.width,
        rect.height,
        iconSize,
        LABEL_HEIGHT
      );
      setPositions((prev) => ({
        ...prev,
        [dragging]: constrained
      }));
    },
    [dragging, dragOffset, iconSize, selectionBox]
  );

  const handlePointerUp = useCallback(() => {
    // Handle selection box finalization
    if (isSelectingRef.current && selectionBox) {
      const boxWidth = Math.abs(selectionBox.endX - selectionBox.startX);
      const boxHeight = Math.abs(selectionBox.endY - selectionBox.startY);

      // Only select icons if the box is large enough (not just a click)
      if (
        boxWidth > MIN_SELECTION_DRAG_DISTANCE ||
        boxHeight > MIN_SELECTION_DRAG_DISTANCE
      ) {
        const selected = new Set<string>();
        appItems.forEach((item) => {
          const pos = positions[item.path];
          if (
            pos &&
            boxIntersectsIcon(selectionBox, pos, iconSize, itemHeight)
          ) {
            selected.add(item.path);
          }
        });
        setSelectedIcons(selected);
      }

      isSelectingRef.current = false;
      setSelectionBox(null);
      return;
    }

    // Handle icon drag finalization
    if (dragging && hasDragged) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    }
    setDragging(null);
  }, [
    dragging,
    hasDragged,
    positions,
    selectionBox,
    appItems,
    iconSize,
    itemHeight
  ]);

  const handleDoubleClick = useCallback(
    (path: string) => {
      if (!hasDragged) {
        const windowType = PATH_TO_WINDOW_TYPE[path];
        if (windowType) {
          openWindow(windowType);
        } else {
          navigate(path);
        }
      }
    },
    [hasDragged, navigate, openWindow]
  );

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCanvasContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleIconContextMenu = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIconContextMenu({ x: e.clientX, y: e.clientY, path });
    },
    []
  );

  const applyArrangement = useCallback(
    (
      arrangementFn: (
        items: typeof navItems,
        width: number,
        height: number,
        isMobile: boolean,
        selectedPaths?: Set<string>,
        currentPositions?: Positions
      ) => Positions
    ) => {
      if (!containerRef.current) return;
      const { offsetWidth: width, offsetHeight: height } = containerRef.current;
      const hasSelection = selectedIcons.size > 0;

      const newPositions = arrangementFn(
        appItems,
        width,
        height,
        isMobile,
        hasSelection ? selectedIcons : undefined,
        hasSelection ? positions : undefined
      );

      setPositions(newPositions);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPositions));
      if (hasSelection) {
        setSelectedIcons(new Set());
      }
      setCanvasContextMenu(null);
    },
    [appItems, isMobile, selectedIcons, positions]
  );

  const handleAutoArrange = useCallback(() => {
    applyArrangement((items, width, _height, mobile, selected, current) => {
      const sortedItems = sortItemsByLabel(items, (item) => t(item.labelKey));
      return calculateGridPositions(
        sortedItems,
        width,
        mobile,
        selected,
        current
      );
    });
  }, [applyArrangement, t]);

  const handleScatter = useCallback(() => {
    applyArrangement(calculateScatterPositions);
  }, [applyArrangement]);

  const handleCluster = useCallback(() => {
    const hasSelection = selectedIcons.size > 0;
    const itemsToArrange = getItemsToArrange(
      appItems,
      hasSelection ? selectedIcons : undefined
    );
    const maxItemWidth = isMobile
      ? null
      : getMaxIconButtonWidth(
          containerRef.current,
          itemsToArrange.map((item) => item.path)
        );

    applyArrangement((items, width, height, mobile, selected, current) =>
      calculateClusterPositions(
        items,
        width,
        height,
        mobile,
        selected,
        current,
        maxItemWidth ?? undefined
      )
    );
  }, [applyArrangement, appItems, isMobile, selectedIcons]);

  const handleDisplayPropertiesOpen = useCallback(() => {
    setIsDisplayPropertiesOpen(true);
    setCanvasContextMenu(null);
  }, []);

  const handleOpenFromContextMenu = useCallback(() => {
    if (iconContextMenu) {
      navigate(iconContextMenu.path);
    }
    setIconContextMenu(null);
  }, [iconContextMenu, navigate]);

  const handleOpenInWindow = useCallback(() => {
    if (iconContextMenu) {
      const windowType = PATH_TO_WINDOW_TYPE[iconContextMenu.path];
      if (windowType) {
        openWindow(windowType);
      }
    }
    setIconContextMenu(null);
  }, [iconContextMenu, openWindow]);

  const canOpenInWindow = (path: string) => path in PATH_TO_WINDOW_TYPE;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div
        ref={containerRef}
        role="application"
        className={cn(
          'relative h-full w-full flex-1 bg-transparent',
          isMobile ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
        )}
        style={{ touchAction: isMobile ? 'auto' : 'none' }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleCanvasContextMenu}
      >
        <DesktopBackground />
        {/* Selection box overlay */}
        {selectionBox && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/20"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.endX),
              top: Math.min(selectionBox.startY, selectionBox.endY),
              width: Math.abs(selectionBox.endX - selectionBox.startX),
              height: Math.abs(selectionBox.endY - selectionBox.startY),
              zIndex: 50
            }}
          />
        )}
        <div
          className={cn(
            'relative z-10 w-full',
            isMobile &&
              'grid min-h-full content-start justify-items-center gap-6 pt-2 pb-6'
          )}
          style={isMobile ? { gridTemplateColumns } : undefined}
          data-testid={isMobile ? 'home-grid' : undefined}
        >
          {appItems.map((item) => {
            const Icon = item.icon;
            const isSettings = item.path === '/settings';
            const { iconBgClasses, iconFgClass } = getIconStyleClasses(
              isSettings,
              iconDepth
            );
            const pos = positions[item.path] || { x: 0, y: 0 };
            const isDragging = dragging === item.path;
            const isSelected = selectedIcons.has(item.path);
            const cursor = isMobile
              ? 'pointer'
              : isDragging
                ? 'grabbing'
                : 'grab';

            return (
              <button
                key={item.path}
                type="button"
                className={cn(
                  'flex select-none flex-col items-center gap-2 border-none bg-transparent p-0',
                  !isMobile && 'absolute'
                )}
                data-icon-path={item.path}
                style={
                  isMobile
                    ? { cursor }
                    : {
                        left: pos.x,
                        top: pos.y,
                        transition: isDragging ? 'none' : 'left 0.2s, top 0.2s',
                        zIndex: isDragging ? 100 : isSelected ? 10 : 1,
                        cursor
                      }
                }
                {...(isMobile
                  ? { onClick: () => navigate(item.path) }
                  : {
                      onPointerDown: (e: React.PointerEvent) =>
                        handlePointerDown(e, item.path),
                      onDoubleClick: () => handleDoubleClick(item.path)
                    })}
                onContextMenu={(e) => handleIconContextMenu(e, item.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(item.path);
                  }
                }}
              >
                <div
                  className={`${cn(
                    'flex h-14 w-14 items-center justify-center rounded-2xl transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16',
                    isSelected &&
                      'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  )} ${iconBgClasses} ${iconDepthClasses}`}
                >
                  <Icon className={cn('h-7 w-7 sm:h-8 sm:w-8', iconFgClass)} />
                </div>
                <span className="max-w-full truncate text-center text-foreground text-xs">
                  {t(item.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {canvasContextMenu && (
        <ContextMenu
          x={canvasContextMenu.x}
          y={canvasContextMenu.y}
          onClose={() => setCanvasContextMenu(null)}
        >
          <ContextMenuItem
            icon={<LayoutGrid className="h-4 w-4" />}
            onClick={handleAutoArrange}
          >
            {selectedIcons.size > 0 ? 'Auto Arrange Selected' : 'Auto Arrange'}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Square className="h-4 w-4" />}
            onClick={handleCluster}
          >
            {selectedIcons.size > 0 ? 'Cluster Selected' : 'Cluster'}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Monitor className="h-4 w-4" />}
            onClick={handleDisplayPropertiesOpen}
          >
            Display Properties
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Maximize2 className="h-4 w-4" />}
            onClick={handleScatter}
          >
            {selectedIcons.size > 0 ? 'Scatter Selected' : 'Scatter'}
          </ContextMenuItem>
        </ContextMenu>
      )}

      {iconContextMenu && (
        <ContextMenu
          x={iconContextMenu.x}
          y={iconContextMenu.y}
          onClose={() => setIconContextMenu(null)}
        >
          <ContextMenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            onClick={handleOpenFromContextMenu}
          >
            Open
          </ContextMenuItem>
          {canOpenInWindow(iconContextMenu.path) && (
            <ContextMenuItem
              icon={<AppWindow className="h-4 w-4" />}
              onClick={handleOpenInWindow}
            >
              Open in Window
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
      <DisplayPropertiesWindow
        open={isDisplayPropertiesOpen}
        onOpenChange={setIsDisplayPropertiesOpen}
      />
    </div>
  );
}
