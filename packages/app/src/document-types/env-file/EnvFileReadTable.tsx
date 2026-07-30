import { useMemo, useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { DocumentRowDetailOverlay } from "../shared/DocumentRowDetail";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import {
  type TrackerReadColumn,
  TrackerReadTable,
} from "../shared/TrackerReadTable";
import {
  type TrackerIndexRow,
  trackerOrdinalColumn,
  trackerUpdatedColumn,
} from "../shared/trackerIndexColumns";
import { compareTrackerText } from "../shared/trackerValues";
import { EnvFileVariableReadValue } from "./EnvFileVariableReadValue";
import {
  type EnvVariableRow,
  getEnvFileReadValue,
  getEnvFileVariableReadValue,
  toEnvVariableDetailFields,
} from "./envFileVariables";

type EnvFileIndexRow = TrackerIndexRow<EnvVariableRow>;

function getEnvFileColumns(context: {
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
}): ReadonlyArray<TrackerReadColumn<EnvFileIndexRow>> {
  return [
    trackerOrdinalColumn<EnvVariableRow>("Variable order"),
    // Carries no width, so the key is the column that absorbs whatever the
    // measured ones leave — which means the value beside it, whose reveal and
    // copy buttons cannot shrink, never has to.
    {
      cell: (row) => {
        const key = row.entry.key.trim();
        return {
          unranked: key.length === 0,
          text: getEnvFileReadValue(row.entry.key),
          ...(key.length > 0 ? { title: key } : {}),
        };
      },
      compare: (left, right) =>
        compareTrackerText(left.entry.key, right.entry.key),
      fold: "primary",
      header: "Key",
      id: "key",
      monospace: true,
    },
    // Deliberately unsortable — no `compare`: every value on screen is masked, so
    // ordering by one would shuffle the rows by something the reader cannot see.
    // Its width is measured (unlike the key's) because it has to hold a full
    // masked value beside two touch-sized controls; absorbing the table's slack
    // instead collapsed it to nothing on a narrow pane and spilled its buttons
    // over the column beside it.
    {
      cell: (row) => ({
        content: (
          <EnvFileVariableReadValue index={row.index} variable={row.entry} />
        ),
        // The folded row announces the column by this, so it is the masked value
        // the cell shows rather than the secret behind it.
        text: getEnvFileVariableReadValue(row.entry),
      }),
      // Its own folded line, not a half-width share of the primary one: the
      // masked value ends in the four characters that tell two variables apart,
      // and beside a key — with two touch-sized controls of its own to seat — that
      // is exactly the end a half-width cell truncates away.
      fold: "secondary",
      header: "Value",
      id: "value",
      width: "15rem",
    },
    trackerUpdatedColumn<EnvVariableRow>(context),
  ];
}

/**
 * The .env document's index view: every variable as one row of a single sortable
 * table.
 *
 * The detail overlay is rendered beside the table rather than inside a row,
 * because the table frame is a scroll container *and* a containing block — an
 * absolutely positioned backdrop mounted inside it would be clipped to the frame
 * and scroll away with the rows.
 */
export function EnvFileReadTable(params: {
  currentAuthorId: string | null;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const { currentAuthorId, onEnterEdit, resolveRowWriter, variables } = params;
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const rows = useMemo(
    () => variables.map((entry, index) => ({ entry, index })),
    [variables],
  );
  const columns = useMemo(
    () => getEnvFileColumns({ currentAuthorId, resolveRowWriter }),
    [currentAuthorId, resolveRowWriter],
  );
  const detailRow = rows.find((row) => row.entry.id === detailRowId) ?? null;
  const detailKey = detailRow?.entry.key.trim() ?? "";

  return (
    <>
      <TrackerReadTable
        actionsLabel="Actions"
        ariaLabel="Variables"
        columns={columns}
        columnStorageKey="tearleads.env-file.variables:hidden-columns"
        defaultSortColumnId="ordinal"
        emptyLabel="No variables"
        renderActions={(row) => (
          <TrackerReadActions
            actionsAriaLabel={`Env variable ${row.index + 1} actions`}
            detailLabel="Details"
            detailsOpen={detailRowId === row.entry.id}
            directAriaLabel={`Env variable ${row.index + 1} details`}
            onEnterEdit={onEnterEdit}
            onOpenDetails={() => setDetailRowId(row.entry.id)}
          />
        )}
        rowKey={(row) => row.entry.id}
        rows={rows}
        sortMenuLabel="Sort variables"
      />
      {detailRow ? (
        <DocumentRowDetailOverlay
          createdAt={detailRow.entry.createdAt}
          createdBy={
            resolveRowWriter?.(detailRow.entry.createdByPeer) ??
            detailRow.entry.createdBy
          }
          currentAuthorId={currentAuthorId}
          fields={toEnvVariableDetailFields(detailRow.entry, resolveRowWriter)}
          onClose={() => setDetailRowId(null)}
          title={
            detailKey.length > 0 ? detailKey : `Variable ${detailRow.index + 1}`
          }
          updatedAt={detailRow.entry.updatedAt}
          updatedBy={
            resolveRowWriter?.(detailRow.entry.updatedByPeer) ??
            detailRow.entry.updatedBy
          }
        />
      ) : null}
    </>
  );
}
