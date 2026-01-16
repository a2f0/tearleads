import { ExternalLink, LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { navItems } from '@/components/Sidebar';
import { ContextMenu } from '@/components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from '@/components/ui/context-menu/ContextMenuItem';
import { useTypedTranslation } from '@/i18n';

const ICON_SIZE = 64;
const ICON_SIZE_MOBILE = 56;
const GAP = 40;
const GAP_MOBILE = 28;
const LABEL_HEIGHT = 24;
const ITEM_HEIGHT = ICON_SIZE + LABEL_HEIGHT + 8;
const ITEM_HEIGHT_MOBILE = ICON_SIZE_MOBILE + LABEL_HEIGHT + 8;
const STORAGE_KEY = 'desktop-icon-positions';

type Position = { x: number; y: number };
type Positions = Record<string, Position>;

function isElement(target: EventTarget | null): target is Element {
  return target !== null && target instanceof Element;
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

export function Home() {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();

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

  const itemHeight = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const gap = isMobile ? GAP_MOBILE : GAP;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const savedPositions = JSON.parse(saved) as Positions;
          // Validate that all current app items have positions
          const allItemsHavePositions = appItems.every(
            (item) => savedPositions[item.path]
          );
          if (allItemsHavePositions) {
            setPositions(savedPositions);
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
      setPositions((prev) => ({
        ...prev,
        [dragging]: { x: Math.max(0, newX), y: Math.max(0, newY) }
      }));
    },
    [dragging, dragOffset]
  );

  const handlePointerUp = useCallback(() => {
    if (dragging && hasDragged) {
      setPositions((current) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        return current;
      });
    }
    setDragging(null);
  }, [dragging, hasDragged]);

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

  const handleOpenFromContextMenu = useCallback(() => {
    if (iconContextMenu) {
      navigate(iconContextMenu.path);
    }
    setIconContextMenu(null);
  }, [iconContextMenu, navigate]);

  const rows = Math.ceil(
    appItems.length /
      Math.max(
        1,
        Math.floor(
          (containerRef.current?.offsetWidth || 400) /
            (isMobile ? ICON_SIZE_MOBILE + GAP_MOBILE : ICON_SIZE + GAP)
        )
      )
  );
  const canvasHeight = Math.max(
    rows * (itemHeight + gap),
    Object.values(positions).reduce(
      (max, p) => Math.max(max, p.y + itemHeight + gap),
      0
    )
  );

  return (
    <div className="flex h-full flex-1 flex-col">
      <div
        ref={containerRef}
        role="application"
        className="relative h-full w-full flex-1 bg-background"
        style={{ minHeight: canvasHeight, touchAction: 'none' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleCanvasContextMenu}
      >
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
        </ContextMenu>
      )}
    </div>
  );
}
