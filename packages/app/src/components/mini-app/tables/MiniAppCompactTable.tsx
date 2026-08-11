import { type ReactNode, useEffect, useState } from "react";
import { useRoutedLayoutActive } from "../../../navigation/useRoutedLayoutActive";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import {
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  useMiniAppFrameBox,
  useMiniAppVirtualRows,
} from "../virtual/MiniAppVirtual";
import { MiniAppTableCell } from "./MiniAppTable";
import "./MiniAppCompactTable.css";

/** Fixed phone-row pitch shared by the DOM height and virtualization math. */
const MINI_APP_COMPACT_TABLE_ROW_HEIGHT = 56;

/**
 * The frame widths at which a list table folds its columns into two lines.
 *
 * Two thresholds, not one: a table whose frame is being dragged across a single
 * boundary would otherwise re-fold on every pixel while the pointer sits on it.
 * Folding below `ENTER` and unfolding only above `LEAVE` gives the drag a band
 * to rest in. These are frame widths, not viewport widths — the frame excludes
 * the window sidebar and the panel padding — so they sit well below the
 * viewport-level breakpoints in navigation/breakpoints.ts.
 */
const MINI_APP_COMPACT_TABLE_FOLD_ENTER_WIDTH = 440;
const MINI_APP_COMPACT_TABLE_FOLD_LEAVE_WIDTH = 480;

/**
 * Whether a table frame of this width should fold its rows onto two lines.
 *
 * A width of 0 means "not measured yet" — an unmounted frame, a render before
 * the observer has run, or any environment without layout (jsdom/happy-dom).
 * Unmeasured holds the current decision rather than reporting narrow, so a
 * table never folds on the strength of a measurement that never happened.
 *
 * The fold is monotone with respect to its own side effects: folding raises the
 * row pitch, which can only make the content taller, which can only add a
 * vertical scrollbar, which can only make the frame narrower still. So a fold
 * can never un-fold itself, on any scrollbar behaviour.
 */
export function shouldFoldCompactRows(
  frameWidth: number,
  wasCompact: boolean,
): boolean {
  if (!(frameWidth > 0)) {
    return wasCompact;
  }

  return wasCompact
    ? frameWidth < MINI_APP_COMPACT_TABLE_FOLD_LEAVE_WIDTH
    : frameWidth < MINI_APP_COMPACT_TABLE_FOLD_ENTER_WIDTH;
}

export type MiniAppCompactTableField = {
  // An escape hatch for fields that are not plain text — the explorer's item
  // name is a button wrapping a glyph, and a compact header line carries sort
  // buttons. Takes precedence over `text`; a `content` field deliberately has
  // no `label`, so the visually-hidden prefix never lands inside a control's
  // accessible name.
  content?: ReactNode | undefined;
  id: string;
  label?: string | undefined;
  text?: string | undefined;
  title?: string | undefined;
};

type MiniAppCompactTableFieldsProps = {
  primary: ReadonlyArray<MiniAppCompactTableField>;
  secondary: ReadonlyArray<MiniAppCompactTableField>;
};

function MiniAppCompactTableLine({
  accessibleLabels = false,
  fields,
  muted = false,
}: {
  accessibleLabels?: boolean;
  fields: ReadonlyArray<MiniAppCompactTableField>;
  muted?: boolean;
}) {
  // A caller with nothing for this line renders no line at all, so a table can
  // fold onto a single line where two would cost too much height (the explorer
  // item header stacks 44px sort buttons, so a second line would double it).
  if (fields.length === 0) {
    return null;
  }

  return (
    <span
      className={
        muted
          ? "mini-app-compact-table-line mini-app-compact-table-line--muted"
          : "mini-app-compact-table-line"
      }
    >
      {fields.map((field) => (
        <span
          className="mini-app-compact-table-field"
          key={field.id}
          title={field.title}
        >
          {accessibleLabels && field.label && field.text ? (
            <span className="mini-app-compact-table-field-label">
              {field.label}:{" "}
            </span>
          ) : null}
          {field.content ?? field.text}
        </span>
      ))}
    </span>
  );
}

function MiniAppCompactTableLines({
  accessibleLabels = false,
  primary,
  secondary,
  secondaryMuted,
}: MiniAppCompactTableFieldsProps & {
  accessibleLabels?: boolean;
  secondaryMuted: boolean;
}) {
  return (
    <span className="mini-app-compact-table-lines">
      <MiniAppCompactTableLine
        accessibleLabels={accessibleLabels}
        fields={primary}
      />
      <MiniAppCompactTableLine
        accessibleLabels={accessibleLabels}
        fields={secondary}
        muted={secondaryMuted}
      />
    </span>
  );
}

export function MiniAppCompactTableHeader(
  props: MiniAppCompactTableFieldsProps,
) {
  return <MiniAppCompactTableLines {...props} secondaryMuted={false} />;
}

export function MiniAppCompactTableCell({
  visual,
  ...props
}: MiniAppCompactTableFieldsProps & {
  // An optional leading graphic — a blob thumbnail, a type glyph — that spans
  // both lines instead of taking a share of one. The caller sizes it; the slot
  // only reserves its intrinsic width.
  visual?: ReactNode | undefined;
}) {
  const lines = (
    <MiniAppCompactTableLines {...props} accessibleLabels secondaryMuted />
  );

  return (
    <MiniAppTableCell>
      {visual ? (
        <span className="mini-app-compact-table-summary">
          <span className="mini-app-compact-table-visual">{visual}</span>
          {lines}
        </span>
      ) : (
        lines
      )}
    </MiniAppTableCell>
  );
}

/**
 * The frame-width half of the fold decision as a hook: owns the fold state and
 * re-evaluates {@link shouldFoldCompactRows} whenever the measured width
 * changes. Kept internal — the explorer and blob-list tables restate the pair
 * because their fold state must exist before the virtual window derives the
 * measured width from it.
 */
function useCompactFold(frameWidth: number): boolean {
  const [narrowFrame, setNarrowFrame] = useState(false);

  useEffect(() => {
    setNarrowFrame((current) => shouldFoldCompactRows(frameWidth, current));
  }, [frameWidth]);

  return narrowFrame;
}

function useCompactTableTier(): boolean {
  // Phone rows fold the visible data columns into two summary lines. Keep the
  // wider desktop/tablet tables at their existing single-line density. Read the
  // stamped DOM mode (instead of provider-only useCompactRoutedMode) so this
  // predicate stays in lockstep with routed-only table CSS and remains usable
  // by isolated table renders that do not mount AppNavigationProvider.
  const routedLayoutActive = useRoutedLayoutActive();
  const routedLayoutTier = useRoutedLayoutTier();
  return routedLayoutActive && routedLayoutTier === "mobile";
}

/**
 * The row pitch a compact list table renders at. Exported so a table that folds
 * on something other than its own frame — the explorer, whose frame belongs to
 * its detail pane — resolves the same two heights rather than restating them.
 */
export function getMiniAppCompactTableRowHeight(compact: boolean): number {
  return compact
    ? MINI_APP_COMPACT_TABLE_ROW_HEIGHT
    : MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT;
}

/**
 * The viewport-only fold decision, for a table whose scroll frame is measured
 * somewhere else (the explorer item list, whose frame belongs to its detail
 * pane). Tables that own their frame should use {@link useMiniAppCompactTableRows},
 * which folds on the frame's own width as well.
 */
export function useMiniAppCompactTableLayout(): {
  compact: boolean;
  rowHeight: number;
} {
  const compact = useCompactTableTier();
  return { compact, rowHeight: getMiniAppCompactTableRowHeight(compact) };
}

/**
 * The fold decision for a table that renders every one of its rows: a
 * detail-panel section list (the blob browser's Document Links) whose frame
 * grows with the panel and scrolls with it, so there is no window to virtualize.
 *
 * Same rule as {@link useMiniAppCompactTableRows} — the phone tier **or** the
 * frame's own measured width — so both kinds of table fold at the same points,
 * including in a narrow desktop window. The returned `rowHeight` is the pitch to
 * publish on the frame (via `getMiniAppVirtualFrameStyle`); a folded row takes
 * it as a floor and grows past it if its two lines need more.
 */
export function useMiniAppCompactTableFrame(): {
  compact: boolean;
  frameRef: (frame: HTMLDivElement | null) => void;
  rowHeight: number;
} {
  const tierCompact = useCompactTableTier();
  const { frameRef, frameWidth } = useMiniAppFrameBox();
  const narrowFrame = useCompactFold(frameWidth);
  const compact = tierCompact || narrowFrame;

  return {
    compact,
    frameRef,
    rowHeight: getMiniAppCompactTableRowHeight(compact),
  };
}

/**
 * Virtualizes `rows` and decides the fold from the phone tier **or** the
 * frame's own measured width, so a table folds in a narrow window or beside a
 * dragged-open sidebar the same way it does on a phone.
 *
 * The frame width arrives a render late (it is measured after mount), so the
 * first paint is single-line and the fold follows. That ordering is deliberate:
 * the row pitch feeds the virtualization math, so guessing narrow before
 * measuring would size the spacers against a pitch the DOM does not have.
 */
export function useMiniAppCompactTableRows<TItem>(params: {
  rows: ReadonlyArray<TItem>;
}): ReturnType<typeof useMiniAppVirtualRows<TItem>> & {
  compact: boolean;
  rowHeight: number;
} {
  const tierCompact = useCompactTableTier();
  // Not {@link useCompactFold}: the fold state must be readable before the
  // virtualizer call that produces the width it folds on (the pitch feeds the
  // virtualization math), so the state-and-effect pair stays split here.
  const [narrowFrame, setNarrowFrame] = useState(false);
  const compact = tierCompact || narrowFrame;
  const rowHeight = getMiniAppCompactTableRowHeight(compact);
  const virtualRows = useMiniAppVirtualRows({ rowHeight, rows: params.rows });
  const { frameWidth } = virtualRows;

  useEffect(() => {
    setNarrowFrame((current) => shouldFoldCompactRows(frameWidth, current));
  }, [frameWidth]);

  return { ...virtualRows, compact, rowHeight };
}
