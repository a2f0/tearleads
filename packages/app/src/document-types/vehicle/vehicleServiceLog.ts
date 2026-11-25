import {
  AMOUNT_FORMAT_MESSAGE,
  CURRENCY_CODE_FORMAT_MESSAGE,
  formatValueWithUnit,
  isValidAmount,
  isValidCurrencyCode,
  isValidReading,
  READING_FORMAT_MESSAGE,
} from "../shared/documentValueFormats";
import {
  currentDateOnly,
  type RowLogDefinition,
  rowLogCell,
} from "../shared/rowLogModel";

// Each service row carries its own odometer unit and currency, the way a
// weight entry carries its unit: a vehicle-wide choice is an invariant two
// offline peers could each change, and the merge would then restate the other
// peer's history.
const ODOMETER_UNIT_OPTIONS = [
  { label: "mi", value: "mi" },
  { label: "km", value: "km" },
];
const DEFAULT_ODOMETER_UNIT = "mi";

export const VEHICLE_SERVICE_LOG: RowLogDefinition = {
  addLabel: "Add Service",
  columns: [
    {
      fold: "primary",
      header: "Date",
      id: "date",
      monospace: true,
      sort: { by: "text", value: (cells) => rowLogCell(cells, "serviceDate") },
      text: (cells) => rowLogCell(cells, "serviceDate").trim(),
      width: "8rem",
    },
    {
      fold: "primary",
      header: "Work Performed",
      id: "work",
      sort: { by: "text", value: (cells) => rowLogCell(cells, "work") },
      text: (cells) => rowLogCell(cells, "work").trim(),
    },
    {
      fold: "secondary",
      header: "Odometer",
      hideable: true,
      id: "odometer",
      monospace: true,
      // Rows in different units are ordered by their figures as recorded;
      // nothing is converted.
      sort: { by: "number", value: (cells) => rowLogCell(cells, "odometer") },
      text: (cells) =>
        formatValueWithUnit(
          rowLogCell(cells, "odometer"),
          rowLogCell(cells, "odometerUnit"),
        ),
      width: "9rem",
    },
    {
      fold: "secondary",
      header: "Provider",
      hideable: true,
      id: "provider",
      sort: { by: "text", value: (cells) => rowLogCell(cells, "provider") },
      text: (cells) => rowLogCell(cells, "provider").trim(),
      width: "10rem",
    },
    {
      // Unsortable: costs in different currencies have no common order.
      fold: "secondary",
      header: "Cost",
      hideable: true,
      id: "cost",
      monospace: true,
      text: (cells) =>
        formatValueWithUnit(
          rowLogCell(cells, "cost"),
          rowLogCell(cells, "currency"),
        ),
      width: "9rem",
    },
  ],
  createEntry: (previous) => {
    const last = previous.at(-1) ?? {};
    return {
      currency: rowLogCell(last, "currency"),
      odometerUnit: rowLogCell(last, "odometerUnit") || DEFAULT_ODOMETER_UNIT,
      serviceDate: currentDateOnly(),
    };
  },
  emptyLabel: "No service recorded",
  entryLabel: "Service",
  fields: [
    { input: "date", key: "serviceDate", label: "Date" },
    {
      format: { isValid: isValidReading, message: READING_FORMAT_MESSAGE },
      input: "decimal",
      key: "odometer",
      label: "Odometer",
      placeholder: "45120",
    },
    {
      input: "select",
      key: "odometerUnit",
      label: "Unit",
      options: ODOMETER_UNIT_OPTIONS,
    },
    {
      input: "text",
      key: "work",
      label: "Work Performed",
      placeholder: "Oil change",
      required: true,
    },
    { input: "text", key: "provider", label: "Provider" },
    {
      format: { isValid: isValidAmount, message: AMOUNT_FORMAT_MESSAGE },
      input: "decimal",
      key: "cost",
      label: "Cost",
      placeholder: "89.99",
    },
    {
      format: {
        isValid: isValidCurrencyCode,
        message: CURRENCY_CODE_FORMAT_MESSAGE,
      },
      input: "text",
      key: "currency",
      label: "Currency",
      placeholder: "USD",
    },
  ],
  listLabel: "Service History",
  saveLabel: "Save Service",
  storageKey: "tearleads.vehicle.service",
};
