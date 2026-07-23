import type { ReactNode } from "react";
import { useRoutedLayoutActive } from "../../../navigation/useRoutedLayoutActive";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT } from "../virtual/MiniAppVirtual";
import { MiniAppTableCell } from "./MiniAppTable";
import "./MiniAppCompactTable.css";

/** Fixed phone-row pitch shared by the DOM height and virtualization math. */
const MINI_APP_COMPACT_TABLE_ROW_HEIGHT = 56;

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

export function MiniAppCompactTableCell(props: MiniAppCompactTableFieldsProps) {
  return (
    <MiniAppTableCell>
      <MiniAppCompactTableLines {...props} accessibleLabels secondaryMuted />
    </MiniAppTableCell>
  );
}

export function useMiniAppCompactTableLayout(): {
  compact: boolean;
  rowHeight: number;
} {
  // Phone rows fold the visible data columns into two summary lines. Keep the
  // wider desktop/tablet tables at their existing single-line density. Read the
  // stamped DOM mode (instead of provider-only useCompactRoutedMode) so this
  // predicate stays in lockstep with routed-only table CSS and remains usable
  // by isolated table renders that do not mount AppNavigationProvider.
  const routedLayoutActive = useRoutedLayoutActive();
  const routedLayoutTier = useRoutedLayoutTier();
  const compact = routedLayoutActive && routedLayoutTier === "mobile";
  return {
    compact,
    rowHeight: compact
      ? MINI_APP_COMPACT_TABLE_ROW_HEIGHT
      : MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  };
}
