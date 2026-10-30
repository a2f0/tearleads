// The desktop's saved state: where each icon sits on the surface. It is kept
// as JSON text so a host's storage adapter only moves strings, and parsed
// defensively, since storage can hold an older, newer, or damaged copy.

/** An icon's top-left corner, in pixels from the surface's top-left corner. */
export interface DesktopIconPosition {
  x: number;
  y: number;
}

export interface DesktopState {
  /** Icon positions by app id. Icons with no entry take a free grid slot. */
  icons: Readonly<Record<string, DesktopIconPosition>>;
}

const DESKTOP_STATE_VERSION = 1;

/** The grid icons start on: its origin, and the size of one cell. */
export const DESKTOP_ICON_GRID = {
  cellHeight: 96,
  cellWidth: 88,
  originX: 12,
  originY: 12,
} as const;

export const EMPTY_DESKTOP_STATE: DesktopState = { icons: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPosition(value: unknown): DesktopIconPosition | null {
  if (!isRecord(value)) {
    return null;
  }
  const { x, y } = value;
  if (typeof x !== "number" || typeof y !== "number") {
    return null;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
}

/**
 * Reads stored desktop state. Anything unreadable (no text, bad JSON, another
 * version, a malformed position) yields what can be kept, or the empty state.
 */
export function parseDesktopState(serialized: string | null): DesktopState {
  if (serialized === null) {
    return EMPTY_DESKTOP_STATE;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return EMPTY_DESKTOP_STATE;
  }
  if (!isRecord(parsed)) {
    return EMPTY_DESKTOP_STATE;
  }
  const { icons: storedIcons, version } = parsed;
  if (version !== DESKTOP_STATE_VERSION) {
    return EMPTY_DESKTOP_STATE;
  }
  const icons: Record<string, DesktopIconPosition> = {};
  if (isRecord(storedIcons)) {
    for (const [appId, value] of Object.entries(storedIcons)) {
      const position = readPosition(value);
      if (position) {
        icons[appId] = position;
      }
    }
  }
  return { icons };
}

export function serializeDesktopState(state: DesktopState): string {
  return JSON.stringify({ icons: state.icons, version: DESKTOP_STATE_VERSION });
}

function gridSlot(index: number, rows: number): DesktopIconPosition {
  const column = Math.floor(index / rows);
  const row = index % rows;
  return {
    x: DESKTOP_ICON_GRID.originX + column * DESKTOP_ICON_GRID.cellWidth,
    y: DESKTOP_ICON_GRID.originY + row * DESKTOP_ICON_GRID.cellHeight,
  };
}

function overlaps(a: DesktopIconPosition, b: DesktopIconPosition): boolean {
  return (
    Math.abs(a.x - b.x) < DESKTOP_ICON_GRID.cellWidth &&
    Math.abs(a.y - b.y) < DESKTOP_ICON_GRID.cellHeight
  );
}

// Whether one icon hides most of another: their boxes are offset by less than
// half a grid cell on both axes.
function buries(a: DesktopIconPosition, b: DesktopIconPosition): boolean {
  return (
    Math.abs(a.x - b.x) < DESKTOP_ICON_GRID.cellWidth / 2 &&
    Math.abs(a.y - b.y) < DESKTOP_ICON_GRID.cellHeight / 2
  );
}

/** The surface's size; zero while it is not laid out yet. */
export interface DesktopSurfaceSize {
  height: number;
  width: number;
}

/** An icon's box (DesktopIcons.css). */
export const DESKTOP_ICON_SIZE: DesktopSurfaceSize = { height: 88, width: 80 };

function clampAxis(value: number, extent: number, surface: number): number {
  if (surface <= 0) {
    return Math.max(0, value);
  }
  return Math.max(0, Math.min(value, surface - extent));
}

/**
 * Keeps an icon of `size` on the surface. An unmeasured (zero) surface only
 * keeps it off negative coordinates.
 */
export function clampDesktopIconPosition(
  position: DesktopIconPosition,
  size: DesktopSurfaceSize,
  surface: DesktopSurfaceSize,
): DesktopIconPosition {
  return {
    x: clampAxis(position.x, size.width, surface.width),
    y: clampAxis(position.y, size.height, surface.height),
  };
}

/**
 * Where every icon sits on the surface. A stored position is kept, moved onto
 * the surface if it was saved on a larger one, unless an icon earlier in
 * `appIds` already buries it there. Every other icon takes the first grid
 * slot, filled top to bottom then left to right, that no icon covers. The
 * surface height sets how many rows a column holds (at least one).
 */
export function resolveDesktopIconPositions(
  appIds: ReadonlyArray<string>,
  stored: DesktopState["icons"],
  surface: DesktopSurfaceSize,
): Record<string, DesktopIconPosition> {
  // A row fits while the icon's own box does; the cell's spacing below the
  // last one may fall off the surface.
  const rows = Math.max(
    1,
    Math.floor(
      (surface.height - DESKTOP_ICON_GRID.originY - DESKTOP_ICON_SIZE.height) /
        DESKTOP_ICON_GRID.cellHeight,
    ) + 1,
  );
  const positions: Record<string, DesktopIconPosition> = {};
  const taken: DesktopIconPosition[] = [];
  for (const appId of appIds) {
    const saved = stored[appId];
    if (!saved) {
      continue;
    }
    const position = clampDesktopIconPosition(
      saved,
      DESKTOP_ICON_SIZE,
      surface,
    );
    if (!taken.some((other) => buries(other, position))) {
      positions[appId] = position;
      taken.push(position);
    }
  }
  let slot = 0;
  for (const appId of appIds) {
    if (positions[appId]) {
      continue;
    }
    let candidate = gridSlot(slot, rows);
    while (taken.some((position) => overlaps(position, candidate))) {
      slot += 1;
      candidate = gridSlot(slot, rows);
    }
    positions[appId] = candidate;
    taken.push(candidate);
    slot += 1;
  }
  return positions;
}
