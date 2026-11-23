import { useLongPress } from "@tearleads/windowing";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from "react";
import { classNames } from "../../shared/classNames";
import { MiniAppVirtualBlockSpacer } from "../virtual/MiniAppVirtual";
import { MiniAppItemThumb } from "./MiniAppItemThumb";
import "./MiniAppItemGrid.css";

/**
 * The grid's geometry, in pixels. The column count is computed here from the
 * frame's measured width and handed to CSS, rather than left to `auto-fill`,
 * because the virtual window needs the same count to turn lines into items: two
 * answers that disagreed would fetch one set of items and draw another.
 */
const MINI_APP_ITEM_GRID_TILE_MIN_WIDTH = 112;
const MINI_APP_ITEM_GRID_TILE_HEIGHT = 128;
const MINI_APP_ITEM_GRID_GAP = 8;
const MINI_APP_ITEM_GRID_PADDING = 8;

/**
 * One line of tiles plus the gap below it: the pitch the virtual window
 * measures the grid in, the way a table's row height is its pitch.
 */
export const MINI_APP_ITEM_GRID_ROW_HEIGHT =
  MINI_APP_ITEM_GRID_TILE_HEIGHT + MINI_APP_ITEM_GRID_GAP;

/**
 * How many tiles fit across a frame of this width. 0 means the frame is not
 * measured yet; one column until it is keeps the first fetch small.
 */
export function getMiniAppItemGridColumns(frameWidth: number): number {
  if (!(frameWidth > 0)) {
    return 1;
  }

  const innerWidth = frameWidth - 2 * MINI_APP_ITEM_GRID_PADDING;
  return Math.max(
    1,
    Math.floor(
      (innerWidth + MINI_APP_ITEM_GRID_GAP) /
        (MINI_APP_ITEM_GRID_TILE_MIN_WIDTH + MINI_APP_ITEM_GRID_GAP),
    ),
  );
}

/**
 * The virtual window counts lines of tiles; the item query counts items.
 * Lines start on a column boundary, so the window starts on one too.
 */
export function getMiniAppItemGridItemWindow(params: {
  columns: number;
  limit: number;
  offset: number;
}): { limit: number; offset: number } {
  const columns = Math.max(1, params.columns);
  return {
    limit: params.limit * columns,
    offset: params.offset * columns,
  };
}

interface MiniAppItemGridStyle extends CSSProperties {
  "--mini-app-item-grid-columns": number;
  "--mini-app-item-grid-gap": string;
  "--mini-app-item-grid-padding": string;
  "--mini-app-item-grid-row-height": string;
}

function getMiniAppItemGridStyle(columns: number): MiniAppItemGridStyle {
  return {
    "--mini-app-item-grid-columns": columns,
    "--mini-app-item-grid-gap": `${MINI_APP_ITEM_GRID_GAP}px`,
    "--mini-app-item-grid-padding": `${MINI_APP_ITEM_GRID_PADDING}px`,
    "--mini-app-item-grid-row-height": `${MINI_APP_ITEM_GRID_ROW_HEIGHT}px`,
  };
}

/**
 * The windowed tiles of a grid view, with spacers standing in for the lines
 * outside the window. Render it inside the scroll frame whose width chose
 * `columns`.
 *
 * The served window can start mid-line for one render after a resize changes
 * the column count (the rows were fetched for the old count), so the first
 * tile is placed in its own column rather than in the first one; every later
 * tile then lands where it belongs.
 */
export function MiniAppItemGrid<TItem>(props: {
  "aria-label": string;
  columns: number;
  getItemKey: (item: TItem) => string;
  itemOffset: number;
  items: ReadonlyArray<TItem>;
  renderItem: (item: TItem) => ReactNode;
  // Shown under the empty list while there is nothing to draw: loading, a
  // failure, or an empty container.
  status: ReactNode;
  totalCount: number;
}) {
  const columns = Math.max(1, props.columns);
  const { itemOffset, items } = props;
  const leadingColumn = itemOffset % columns;
  const startLine = Math.floor(itemOffset / columns);
  const renderedLines =
    items.length > 0 ? Math.ceil((leadingColumn + items.length) / columns) : 0;
  const totalLines = Math.ceil(props.totalCount / columns);
  const bottomLines = Math.max(0, totalLines - startLine - renderedLines);

  return (
    <div
      className="mini-app-item-grid-body"
      style={getMiniAppItemGridStyle(columns)}
    >
      <MiniAppVirtualBlockSpacer
        height={startLine * MINI_APP_ITEM_GRID_ROW_HEIGHT}
      />
      <ul aria-label={props["aria-label"]} className="mini-app-item-grid">
        {items.map((item, index) => (
          <li
            className="mini-app-item-grid-cell"
            key={props.getItemKey(item)}
            style={
              index === 0 && leadingColumn > 0
                ? { gridColumnStart: leadingColumn + 1 }
                : undefined
            }
          >
            {props.renderItem(item)}
          </li>
        ))}
      </ul>
      {items.length === 0 && props.status ? (
        <p className="mini-app-item-grid-status">{props.status}</p>
      ) : null}
      <MiniAppVirtualBlockSpacer
        height={bottomLines * MINI_APP_ITEM_GRID_ROW_HEIGHT}
      />
    </div>
  );
}

/** The sticky strip above the tiles, for the controls a table keeps in its header. */
export function MiniAppItemGridHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={classNames("mini-app-item-grid-header", className)}
    />
  );
}

/**
 * One tile: a square visual over the item's name, as a single button. A touch
 * hold opens the same context menu a right-click does.
 */
export function MiniAppItemTile({
  className,
  label,
  onContextMenu,
  selected = false,
  visual,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  label: string;
  selected?: boolean | undefined;
  visual: ReactNode;
}) {
  const longPress = useLongPress(Boolean(onContextMenu));

  return (
    <button
      {...props}
      {...longPress}
      className={classNames(
        "mini-app-item-tile",
        selected && "mini-app-item-tile--selected",
        className,
      )}
      onContextMenu={onContextMenu}
      title={label}
      type="button"
    >
      <MiniAppItemThumb className="mini-app-item-tile-visual">
        {visual}
      </MiniAppItemThumb>
      <span className="mini-app-item-tile-label">{label}</span>
    </button>
  );
}
