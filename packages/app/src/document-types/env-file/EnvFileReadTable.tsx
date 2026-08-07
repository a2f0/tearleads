import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { TrackerIndexTable } from "../shared/TrackerIndexTable";
import type { TrackerReadColumn } from "../shared/TrackerReadTable";
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

function buildEnvFileRows(
  variables: ReadonlyArray<EnvVariableRow>,
): EnvFileIndexRow[] {
  return variables.map((entry, index) => ({ entry, index }));
}

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
  onEnterEdit?: ((id: string) => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const { currentAuthorId, onEnterEdit, resolveRowWriter, variables } = params;

  return (
    <TrackerIndexTable
      actionsAriaLabel={(row) => `Env variable ${row.index + 1} actions`}
      ariaLabel="Variables"
      buildRows={buildEnvFileRows}
      columnStorageKey="tearleads.env-file.variables:hidden-columns:v2"
      currentAuthorId={currentAuthorId}
      detailFields={toEnvVariableDetailFields}
      detailLabel="Details"
      detailTitle={(row) => row.entry.key.trim() || `Variable ${row.index + 1}`}
      directAriaLabel={(row) => `Env variable ${row.index + 1} details`}
      emptyLabel="No variables"
      entries={variables}
      getColumns={getEnvFileColumns}
      onEnterEdit={onEnterEdit}
      resolveRowWriter={resolveRowWriter}
      sortMenuLabel="Sort variables"
    />
  );
}
