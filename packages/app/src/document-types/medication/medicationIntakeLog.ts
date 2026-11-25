import {
  currentDateTimeLocal,
  type RowLogDefinition,
  rowLogCell,
} from "../shared/rowLogModel";

// Doses as taken, kept apart from the prescribed directions so a missed or
// changed dose never rewrites what was prescribed. Recording only: nothing
// here suggests, checks, or schedules a dose.
export const MEDICATION_INTAKE_LOG: RowLogDefinition = {
  addLabel: "Log Dose",
  columns: [
    {
      fold: "primary",
      header: "Taken",
      id: "taken",
      monospace: true,
      // Local wall-clock times in one fixed-width format order as text.
      sort: { by: "text", value: (cells) => rowLogCell(cells, "takenAt") },
      text: (cells) => rowLogCell(cells, "takenAt").trim().replace("T", " "),
      width: "10rem",
    },
    {
      fold: "primary",
      header: "Amount",
      id: "dose",
      sort: { by: "text", value: (cells) => rowLogCell(cells, "dose") },
      text: (cells) => rowLogCell(cells, "dose").trim(),
      width: "9rem",
    },
    {
      fold: "secondary",
      header: "Notes",
      id: "notes",
      muted: true,
      text: (cells) => rowLogCell(cells, "notes").trim(),
    },
  ],
  createEntry: (previous) => ({
    dose: rowLogCell(previous.at(-1) ?? {}, "dose"),
    takenAt: currentDateTimeLocal(),
  }),
  emptyLabel: "No doses logged",
  entryLabel: "Dose",
  fields: [
    { input: "datetime-local", key: "takenAt", label: "Taken", required: true },
    { input: "text", key: "dose", label: "Amount", placeholder: "1 tablet" },
    { input: "text", key: "notes", label: "Notes" },
  ],
  listLabel: "Intake Log",
  saveLabel: "Save Dose",
  storageKey: "tearleads.medication.intake",
};
