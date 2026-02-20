import type {
  DesktopIconBackgroundValue,
  DesktopIconDepthValue
} from '@tearleads/settings';
import type { navItems } from '@/components/Sidebar';

export const ICON_SIZE = 64;
const ICON_SIZE_MOBILE = 56;
export const GAP = 40;
const GAP_MOBILE = 28;
export const LABEL_HEIGHT = 16;
export const ICON_LABEL_GAP = 8;
export const ITEM_HEIGHT = ICON_SIZE + LABEL_HEIGHT + ICON_LABEL_GAP;
const ITEM_HEIGHT_MOBILE = ICON_SIZE_MOBILE + LABEL_HEIGHT + ICON_LABEL_GAP;
export const OVERLAP_PADDING = 4;

export type Position = { x: number; y: number };
export type Positions = Record<string, Position>;

export function getIconStyleClasses(
  iconDepth?: DesktopIconDepthValue,
  iconBackground?: DesktopIconBackgroundValue
) {
  if (iconBackground === 'transparent') {
    return {
      iconBgClasses: 'bg-transparent',
      iconFgClass: 'text-foreground'
    };
  }

  const isDebossed = iconDepth === 'debossed';
  if (isDebossed) {
    return {
      iconBgClasses:
        'bg-primary-foreground from-primary-foreground/80 to-primary-foreground',
      iconFgClass: 'text-primary'
    };
  }

  return {
    iconBgClasses: 'bg-primary from-primary/80 to-primary',
    iconFgClass: 'text-primary-foreground'
  };
}

export function getItemsToArrange(
  items: typeof navItems,
  selectedPaths?: Set<string>
): typeof navItems {
  return selectedPaths && selectedPaths.size > 0
    ? items.filter((item) => selectedPaths.has(item.path))
    : items;
}

export function sortItemsByLabel(
  items: typeof navItems,
  getLabel: (item: (typeof navItems)[number]) => string
): typeof navItems {
  return [...items].sort((a, b) =>
    getLabel(a).localeCompare(getLabel(b), undefined, { sensitivity: 'base' })
  );
}

export function positionsAreEqual(p1: Positions, p2: Positions): boolean {
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

function overlapsAny(
  x: number,
  y: number,
  itemWidth: number,
  itemHeight: number,
  placed: Array<{ x: number; y: number }>
): boolean {
  for (const p of placed) {
    if (
      x < p.x + itemWidth + OVERLAP_PADDING &&
      x + itemWidth + OVERLAP_PADDING > p.x &&
      y < p.y + itemHeight + OVERLAP_PADDING &&
      y + itemHeight + OVERLAP_PADDING > p.y
    ) {
      return true;
    }
  }
  return false;
}

function findNearestFreePosition(
  originX: number,
  originY: number,
  itemWidth: number,
  itemHeight: number,
  stepX: number,
  stepY: number,
  maxX: number,
  maxY: number,
  placed: Array<{ x: number; y: number }>
): Position | null {
  const maxRings =
    Math.max(Math.ceil(maxX / stepX), Math.ceil(maxY / stepY)) + 1;

  for (let ring = 1; ring <= maxRings; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;

        const clampedX = Math.max(0, Math.min(originX + dx * stepX, maxX));
        const clampedY = Math.max(0, Math.min(originY + dy * stepY, maxY));

        if (!overlapsAny(clampedX, clampedY, itemWidth, itemHeight, placed)) {
          return { x: clampedX, y: clampedY };
        }
      }
    }
  }

  return null;
}

export function resolveOverlaps(
  positions: Positions,
  containerWidth: number,
  containerHeight: number,
  iconSize: number,
  labelHeight: number
): Positions {
  const itemWidth = iconSize;
  const itemHeight = iconSize + labelHeight + ICON_LABEL_GAP;
  const cellW = itemWidth + OVERLAP_PADDING;
  const cellH = itemHeight + OVERLAP_PADDING;
  const maxX = containerWidth - itemWidth;
  const maxY = containerHeight - itemHeight;

  if (maxX < 0 || maxY < 0) {
    return positions;
  }

  const entries = Object.entries(positions).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const placed: Array<{ x: number; y: number }> = [];
  const resolved: Positions = {};

  for (const [key, pos] of entries) {
    if (!overlapsAny(pos.x, pos.y, itemWidth, itemHeight, placed)) {
      resolved[key] = pos;
      placed.push({ x: pos.x, y: pos.y });
      continue;
    }

    const found = findNearestFreePosition(
      pos.x,
      pos.y,
      itemWidth,
      itemHeight,
      cellW,
      cellH,
      maxX,
      maxY,
      placed
    );

    if (found) {
      resolved[key] = found;
      placed.push({ x: found.x, y: found.y });
    } else {
      resolved[key] = pos;
      placed.push({ x: pos.x, y: pos.y });
    }
  }

  return resolved;
}

export function constrainPosition(
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

export function constrainAllPositions(
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
  return resolveOverlaps(
    constrained,
    containerWidth,
    containerHeight,
    iconSize,
    labelHeight
  );
}

export function calculateGridPositions(
  items: typeof navItems,
  containerWidth: number,
  isMobile: boolean,
  selectedPaths?: Set<string>,
  currentPositions?: Positions
): Positions {
  const iconSize = getIconSizeForMobile(isMobile);
  const gap = getGapForMobile(isMobile);
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

export function calculateScatterPositions(
  items: typeof navItems,
  containerWidth: number,
  containerHeight: number,
  isMobile: boolean,
  selectedPaths?: Set<string>,
  currentPositions?: Positions
): Positions {
  const iconSize = getIconSizeForMobile(isMobile);
  const itemHeightCalc = getItemHeightForMobile(isMobile);
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

export function boxIntersectsIcon(
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

export function calculateClusterPositions(
  items: typeof navItems,
  containerWidth: number,
  containerHeight: number,
  isMobile: boolean,
  selectedPaths?: Set<string>,
  currentPositions?: Positions,
  maxItemWidth?: number,
  maxItemHeight?: number,
  itemHeights?: Record<string, number>,
  itemWidths?: Record<string, number>
): Positions {
  const iconSize = getIconSizeForMobile(isMobile);
  const gap = getGapForMobile(isMobile);
  const itemHeightCalc = getItemHeightForMobile(isMobile);
  const clusterItemWidth = Math.max(iconSize, maxItemWidth ?? 0);
  const clusterItemHeight = Math.max(itemHeightCalc, maxItemHeight ?? 0);
  const itemWidth = clusterItemWidth + gap;
  const itemHeightWithGap = clusterItemHeight + gap;

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
    const itemWidthValue = itemWidths?.[item.path] ?? iconSize;
    const horizontalOffset = Math.max(
      0,
      (clusterItemWidth - itemWidthValue) / 2
    );
    const itemHeightValue = itemHeights?.[item.path] ?? itemHeightCalc;
    const verticalOffset = Math.max(
      0,
      (clusterItemHeight - itemHeightValue) / 2
    );
    positions[item.path] = {
      x: startX + col * itemWidth + horizontalOffset,
      y: startY + row * itemHeightWithGap + verticalOffset
    };
  });
  return positions;
}

export function getIconButtonMeasurements(
  container: HTMLDivElement | null,
  paths: string[]
): {
  maxWidth: number;
  maxHeight: number;
  itemHeights: Record<string, number>;
  itemWidths: Record<string, number>;
} | null {
  if (!container || paths.length === 0) {
    return null;
  }

  const pathSet = new Set(paths);
  let maxWidth = 0;
  let maxHeight = 0;
  const itemHeights: Record<string, number> = {};
  const itemWidths: Record<string, number> = {};

  container
    .querySelectorAll<HTMLButtonElement>('button[data-icon-path]')
    .forEach((button) => {
      const path = button.dataset['iconPath'];
      if (!path || !pathSet.has(path)) {
        return;
      }
      const measuredWidth =
        button.offsetWidth || button.getBoundingClientRect().width;
      const measuredHeight =
        button.offsetHeight || button.getBoundingClientRect().height;
      if (measuredWidth > maxWidth) {
        maxWidth = measuredWidth;
      }
      if (measuredHeight > maxHeight) {
        maxHeight = measuredHeight;
      }
      if (measuredWidth > 0) {
        itemWidths[path] = measuredWidth;
      }
      if (measuredHeight > 0) {
        itemHeights[path] = measuredHeight;
      }
    });

  if (maxWidth <= 0 && maxHeight <= 0) {
    return null;
  }

  return {
    maxWidth: maxWidth > 0 ? Math.ceil(maxWidth) : 0,
    maxHeight: maxHeight > 0 ? Math.ceil(maxHeight) : 0,
    itemHeights,
    itemWidths
  };
}

export function getIconSizeForMobile(isMobile: boolean): number {
  return isMobile ? ICON_SIZE_MOBILE : ICON_SIZE;
}

export function getItemHeightForMobile(isMobile: boolean): number {
  return isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
}

export function getGapForMobile(isMobile: boolean): number {
  return isMobile ? GAP_MOBILE : GAP;
}
