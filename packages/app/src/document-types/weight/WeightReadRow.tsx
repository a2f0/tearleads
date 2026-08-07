import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { TrackerReadCard } from "../shared/TrackerReadCard";
import {
  formatMeasuredAt,
  formatWeight,
  formatWeightChange,
  toWeightEntryDetailFields,
  type WeightEntryRow,
} from "./weightEntries";

export function WeightEntryReadRow(params: {
  currentAuthorId: string | null;
  entry: WeightEntryRow;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  previous: WeightEntryRow | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const {
    currentAuthorId,
    entry,
    index,
    onEnterEdit,
    previous,
    resolveRowWriter,
  } = params;

  return (
    <TrackerReadCard
      actionsAriaLabel={`Entry ${index + 1} actions`}
      cells={[
        { label: "Weight", text: formatWeight(entry) },
        {
          label: "Change",
          text: formatWeightChange(entry, previous) ?? "—",
        },
        { label: "Measured", text: formatMeasuredAt(entry) },
      ]}
      className="weight-entry-read-row"
      currentAuthorId={currentAuthorId}
      detailFields={toWeightEntryDetailFields(entry, resolveRowWriter)}
      detailLabel="Attribution"
      detailTitle={`Entry ${index + 1}`}
      directAriaLabel={`Entry ${index + 1} attribution`}
      index={index}
      notes={entry.notes}
      onEnterEdit={onEnterEdit}
      resolveRowWriter={resolveRowWriter}
      row={entry}
      showFieldValues={false}
    />
  );
}
