import {
  AppWindow,
  ExternalLink,
  LayoutGrid,
  Maximize2,
  Square
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { navItems } from '@/components/Sidebar';
import { ContextMenu } from '@/components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from '@/components/ui/context-menu/ContextMenuItem';
import { DesktopBackground } from '@/components/ui/desktop-background';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useTypedTranslation } from '@/i18n';

const ICON_SIZE = 64;
const ICON_SIZE_MOBILE = 56;
const GAP = 40;
const GAP_MOBILE = 28;
const LABEL_HEIGHT = 24;
const ICON_LABEL_GAP = 8;
const ITEM_HEIGHT = ICON_SIZE + LABEL_HEIGHT + ICON_LABEL_GAP;
const ITEM_HEIGHT_MOBILE = ICON_SIZE_MOBILE + LABEL_HEIGHT + ICON_LABEL_GAP;
const STORAGE_KEY = 'desktop-icon-positions';

type Position = { x: number; y: number };
type Positions = Record<string, Position>;

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
  isMobile: boolean
): Positions {
  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const gap = isMobile ? GAP_MOBILE : GAP;
  const itemWidth = iconSize + gap;
  const cols = Math.max(1, Math.floor(containerWidth / itemWidth));
  const totalWidth = cols * itemWidth - gap;
  const startX = (containerWidth - totalWidth) / 2;

  const positions: Positions = {};
  items.forEach((item, index) => {
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
  isMobile: boolean
): Positions {
  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const itemHeight = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const maxX = Math.max(0, containerWidth - iconSize);
  const maxY = Math.max(0, containerHeight - itemHeight);

  const positions: Positions = {};
  items.forEach((item) => {
    positions[item.path] = {
      x: Math.floor(Math.random() * maxX),
      y: Math.floor(Math.random() * maxY)
    };
  });
  return positions;
}

function calculateClusterPositions(
  items: typeof navItems,
  containerWidth: number,
  containerHeight: number,
  isMobile: boolean
): Positions {
  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
  const gap = isMobile ? GAP_MOBILE : GAP;
  const itemHeight = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const itemWidth = iconSize + gap;
  const itemHeightWithGap = itemHeight + gap;

  // Calculate grid dimensions for a square-ish arrangement
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);

  // Calculate total cluster dimensions
  const clusterWidth = cols * itemWidth - gap;
  const clusterHeight = rows * itemHeightWithGap - gap;

  // Center the cluster
  const startX = Math.max(0, (containerWidth - clusterWidth) / 2);
  const startY = Math.max(0, (containerHeight - clusterHeight) / 2);

  const positions: Positions = {};
  items.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions[item.path] = {
      x: startX + col * itemWidth,
      y: startY + row * itemHeightWithGap
    };
  });
  return positions;
}

export function Home() {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();
  const { openWindow } = useWindowManager();

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
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  const iconSize = isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
      // Constrain positions to new viewport bounds (only if container has valid dimensions)
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        if (width > 0 && height > 0) {
          const currentIconSize =
            window.innerWidth < 640 ? ICON_SIZE_MOBILE : ICON_SIZE;
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
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = positions[path];
      if (!pos || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDragging(path);
      setHasDragged(false);
      setDragOffset({
        x: e.clientX - rect.left - pos.x,
        y: e.clientY - rect.top - pos.y
      });
      if (isElement(e.target)) {
        e.target.setPointerCapture(e.pointerId);
      }
    },
    [positions]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return;
      setHasDragged(true);
      const rect = containerRef.current.getBoundingClientRect();
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
    [dragging, dragOffset, iconSize]
  );

  const handlePointerUp = useCallback(() => {
    if (dragging && hasDragged) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    }
    setDragging(null);
  }, [dragging, hasDragged, positions]);

  const handleDoubleClick = useCallback(
    (path: string) => {
      if (!hasDragged) {
        navigate(path);
      }
    },
    [hasDragged, navigate]
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

  const handleAutoArrange = useCallback(() => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth;
      setPositions(calculateGridPositions(appItems, width, isMobile));
      localStorage.removeItem(STORAGE_KEY);
    }
    setCanvasContextMenu(null);
  }, [appItems, isMobile]);

  const handleScatter = useCallback(() => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;
      setPositions(
        calculateScatterPositions(appItems, width, height, isMobile)
      );
      localStorage.removeItem(STORAGE_KEY);
    }
    setCanvasContextMenu(null);
  }, [appItems, isMobile]);

  const handleCluster = useCallback(() => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;
      setPositions(
        calculateClusterPositions(appItems, width, height, isMobile)
      );
      localStorage.removeItem(STORAGE_KEY);
    }
    setCanvasContextMenu(null);
  }, [appItems, isMobile]);

  const handleOpenFromContextMenu = useCallback(() => {
    if (iconContextMenu) {
      navigate(iconContextMenu.path);
    }
    setIconContextMenu(null);
  }, [iconContextMenu, navigate]);

  const handleOpenInWindow = useCallback(() => {
    if (iconContextMenu) {
      const path = iconContextMenu.path;
      if (path === '/notes') {
        openWindow('notes');
      } else if (path === '/console') {
        openWindow('console');
      }
    }
    setIconContextMenu(null);
  }, [iconContextMenu, openWindow]);

  const canOpenInWindow = (path: string) =>
    path === '/notes' || path === '/console';

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div
        ref={containerRef}
        role="application"
        className="relative h-full w-full flex-1 overflow-hidden bg-background"
        style={{ touchAction: 'none' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleCanvasContextMenu}
      >
        <DesktopBackground />
        {appItems.map((item) => {
          const Icon = item.icon;
          const isSettings = item.path === '/settings';
          const bgClasses = isSettings
            ? 'bg-muted-foreground from-muted-foreground/60 to-muted-foreground'
            : 'bg-primary from-primary/80 to-primary';
          const pos = positions[item.path] || { x: 0, y: 0 };
          const isDragging = dragging === item.path;

          return (
            <button
              key={item.path}
              type="button"
              className="absolute flex select-none flex-col items-center gap-2 border-none bg-transparent p-0"
              style={{
                left: pos.x,
                top: pos.y,
                transition: isDragging ? 'none' : 'left 0.2s, top 0.2s',
                zIndex: isDragging ? 100 : 1,
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
              onPointerDown={(e) => handlePointerDown(e, item.path)}
              onDoubleClick={() => handleDoubleClick(item.path)}
              onContextMenu={(e) => handleIconContextMenu(e, item.path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(item.path);
                }
              }}
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${bgClasses} shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16`}
              >
                <Icon className="h-7 w-7 text-primary-foreground sm:h-8 sm:w-8" />
              </div>
              <span className="max-w-full truncate text-center text-foreground text-xs">
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
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
            Auto Arrange
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Maximize2 className="h-4 w-4" />}
            onClick={handleScatter}
          >
            Scatter
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Square className="h-4 w-4" />}
            onClick={handleCluster}
          >
            Cluster
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
    </div>
  );
}
