import type { ReactNode } from "react";
import {
  MiniAppInfoHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";

export interface OpsHealthColumn<Row> {
  readonly cell: (row: Row) => ReactNode;
  readonly header: string;
  readonly id: string;
}

/** One ops-health section: its organizations, each linking to its detail. */
export function OpsHealthTable<Row extends { organizationId: string }>({
  columns,
  description,
  empty,
  label,
  onSelectOrganization,
  section,
}: {
  columns: ReadonlyArray<OpsHealthColumn<Row>>;
  description: string;
  empty: string;
  label: string;
  onSelectOrganization: (organizationId: string) => void;
  section: { readonly rows: ReadonlyArray<Row>; readonly truncated: boolean };
}) {
  const headers = [
    { id: "organization", header: "Organization ID" },
    ...columns.map(({ header, id }) => ({ header, id })),
  ];
  return (
    <>
      <MiniAppInfoHeading>{label}</MiniAppInfoHeading>
      <MiniAppStatus>{description}</MiniAppStatus>
      <MiniAppTableFrame>
        <MiniAppTable aria-label={label} columns={headers}>
          {section.rows.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={headers.length}>
              {empty}
            </MiniAppTableEmptyRow>
          ) : (
            section.rows.map((row) => (
              <MiniAppTableRow
                key={row.organizationId}
                interactive
                onActivate={() => onSelectOrganization(row.organizationId)}
              >
                <MiniAppTableCell>
                  <MiniAppTableActionButton
                    onClick={() => onSelectOrganization(row.organizationId)}
                  >
                    {row.organizationId}
                  </MiniAppTableActionButton>
                </MiniAppTableCell>
                {columns.map((column) => (
                  <MiniAppTableCell key={column.id}>
                    <MiniAppTableText>{column.cell(row)}</MiniAppTableText>
                  </MiniAppTableCell>
                ))}
              </MiniAppTableRow>
            ))
          )}
        </MiniAppTable>
      </MiniAppTableFrame>
      {section.truncated && (
        <MiniAppStatus>
          Showing the first {section.rows.length} organizations; more match.
        </MiniAppStatus>
      )}
    </>
  );
}
