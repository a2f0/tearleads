import { MiniAppTableCell } from "../../../components/mini-app/MiniAppTable";
import { MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";

/** Fixed phone-row pitch shared by the DOM height and virtualization math. */
const ORG_MANAGER_COMPACT_TABLE_ROW_HEIGHT = 56;

export type OrgManagerCompactTableField = {
  id: string;
  label?: string;
  text: string;
  title?: string;
};

type OrgManagerCompactTableFieldsProps = {
  primary: ReadonlyArray<OrgManagerCompactTableField>;
  secondary: ReadonlyArray<OrgManagerCompactTableField>;
};

function OrgManagerCompactTableLine({
  accessibleLabels = false,
  fields,
  muted = false,
}: {
  accessibleLabels?: boolean;
  fields: ReadonlyArray<OrgManagerCompactTableField>;
  muted?: boolean;
}) {
  return (
    <span
      className={
        muted
          ? "org-manager-compact-table-line org-manager-compact-table-line--muted"
          : "org-manager-compact-table-line"
      }
    >
      {fields.map((field) => (
        <span
          className="org-manager-compact-table-field"
          key={field.id}
          title={field.title}
        >
          {accessibleLabels && field.label ? (
            <span className="org-manager-compact-table-field-label">
              {field.label}:{" "}
            </span>
          ) : null}
          {field.text}
        </span>
      ))}
    </span>
  );
}

function OrgManagerCompactTableLines({
  accessibleLabels = false,
  primary,
  secondary,
  secondaryMuted,
}: OrgManagerCompactTableFieldsProps & {
  accessibleLabels?: boolean;
  secondaryMuted: boolean;
}) {
  return (
    <span className="org-manager-compact-table-lines">
      <OrgManagerCompactTableLine
        accessibleLabels={accessibleLabels}
        fields={primary}
      />
      <OrgManagerCompactTableLine
        accessibleLabels={accessibleLabels}
        fields={secondary}
        muted={secondaryMuted}
      />
    </span>
  );
}

export function OrgManagerCompactTableHeader(
  props: OrgManagerCompactTableFieldsProps,
) {
  return <OrgManagerCompactTableLines {...props} secondaryMuted={false} />;
}

export function OrgManagerCompactTableCell(
  props: OrgManagerCompactTableFieldsProps,
) {
  return (
    <MiniAppTableCell>
      <OrgManagerCompactTableLines {...props} accessibleLabels secondaryMuted />
    </MiniAppTableCell>
  );
}

export function useOrgManagerListTableLayout(): {
  compact: boolean;
  rowHeight: number;
} {
  // Phone rows fold the visible data columns into two summary lines. Keep the
  // wider desktop/tablet tables at their existing single-line density.
  const compact = useRoutedLayoutTier() === "mobile";
  return {
    compact,
    rowHeight: compact
      ? ORG_MANAGER_COMPACT_TABLE_ROW_HEIGHT
      : MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  };
}
