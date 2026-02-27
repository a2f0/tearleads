import { useSettings } from '@tearleads/settings';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem,
  DesktopContextMenuSeparator as ContextMenuSeparator
} from '@tearleads/window-manager';
import {
  AppWindow,
  ExternalLink,
  LayoutGrid,
  Maximize2,
  Monitor,
  Sparkles,
  Square
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { navItems } from '@/components/Sidebar';
import { DisplayPropertiesWindow } from '@/components/settings/DisplayPropertiesWindow';
import { DesktopBackground } from '@/components/ui/desktop-background';
import { MOBILE_BREAKPOINT } from '@/constants/breakpoints';
import { useIsMobile } from '@/hooks/device';
import { useTypedTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { MOBILE_COLUMNS, STORAGE_KEY } from './home-components/constants';
import { useHomeArrangement } from './home-components/useHomeArrangement';
import { useHomeContextMenu } from './home-components/useHomeContextMenu';
import { useHomeIconDrag } from './home-components/useHomeIconDrag';
import {
  calculateGridPositions,
  constrainAllPositions,
  getIconSizeForMobile,
  getIconStyleClasses,
  getItemHeightForMobile,
  LABEL_HEIGHT,
  type Positions,
  positionsAreEqual,
  sortItemsByLabel
} from './homeIconUtils';

export { PATH_TO_WINDOW_TYPE } from './home-components/constants';

export function Home() {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();
  const { getSetting } = useSettings();

  const appItems = useMemo(
    () => navItems.filter((item) => item.path !== '/'),
    []
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const translateRef = useRef(t);
  translateRef.current = t;
  const [positions, setPositions] = useState<Positions>({});
  const isMobile = useIsMobile();

  const iconSize = getIconSizeForMobile(isMobile);
  const itemHeight = getItemHeightForMobile(isMobile);
  const gridTemplateColumns = `repeat(${MOBILE_COLUMNS}, minmax(0, 1fr))`;
  const iconDepth = getSetting('desktopIconDepth');
  const iconBackground = getSetting('desktopIconBackground');
  const iconDepthClasses =
    iconBackground === 'transparent'
      ? ''
      : iconDepth === 'debossed'
        ? 'bg-gradient-to-tl shadow-inner'
        : 'bg-gradient-to-br shadow-lg';

  const {
    dragging,
    hasDragged,
    selectionBox,
    selectedIcons,
    setSelectedIcons,
    handlePointerDown,
    handleCanvasPointerDown,
    handlePointerMove,
    handlePointerUp
  } = useHomeIconDrag(
    positions,
    setPositions,
    containerRef,
    appItems,
    iconSize,
    itemHeight,
    isMobile
  );

  const {
    canvasContextMenu,
    setCanvasContextMenu,
    iconContextMenu,
    setIconContextMenu,
    isDisplayPropertiesOpen,
    setIsDisplayPropertiesOpen,
    handleCanvasContextMenu,
    handleIconContextMenu,
    handleDisplayPropertiesOpen,
    handleStartScreensaver,
    handleOpenFromContextMenu,
    handleOpenInWindow,
    handleDoubleClick,
    canOpenInWindow
  } = useHomeContextMenu(hasDragged);

  const translateMenuKey = useCallback(
    (key: string) => t(key as Parameters<typeof t>[0]),
    [t]
  );
  const { handleAutoArrange, handleScatter, handleCluster } =
    useHomeArrangement(
      appItems,
      positions,
      setPositions,
      containerRef,
      selectedIcons,
      setSelectedIcons,
      setCanvasContextMenu,
      isMobile,
      translateMenuKey
    );

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        if (width > 0 && height > 0) {
          const currentIconSize = getIconSizeForMobile(
            window.innerWidth < MOBILE_BREAKPOINT
          );
          setPositions((prev) => {
            const constrained = constrainAllPositions(
              prev,
              width,
              height,
              currentIconSize,
              LABEL_HEIGHT
            );
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
          const allItemsHavePositions = appItems.every((item) => {
            const pos = savedPositions[item.path];
            return (
              pos && typeof pos.x === 'number' && typeof pos.y === 'number'
            );
          });
          if (allItemsHavePositions) {
            if (width > 0 && height > 0) {
              const currentIconSize = getIconSizeForMobile(isMobile);
              const constrained = constrainAllPositions(
                savedPositions,
                width,
                height,
                currentIconSize,
                LABEL_HEIGHT
              );
              setPositions(constrained);
            } else {
              setPositions(savedPositions);
            }
            return;
          }
        } catch {
          // Invalid JSON, fall through to default grid
        }
      }
      const sortedItems = sortItemsByLabel(appItems, (item) =>
        translateRef.current(item.labelKey as Parameters<typeof t>[0])
      );
      setPositions(calculateGridPositions(sortedItems, width, isMobile));
    }
  }, [appItems, isMobile]);

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
            const { iconBgClasses, iconFgClass } = getIconStyleClasses(
              iconDepth,
              iconBackground
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
            icon={<Monitor className="h-4 w-4" />}
            onClick={handleDisplayPropertiesOpen}
          >
            Display Properties
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Sparkles className="h-4 w-4" />}
            onClick={handleStartScreensaver}
          >
            Start Screensaver
          </ContextMenuItem>
          <ContextMenuSeparator />
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
