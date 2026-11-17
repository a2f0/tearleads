import {
  type DocumentHistoryChange,
  isEmptyDocumentHistoryChange,
} from "@tearleads/client-sdk";
import { EXPLORER_LABELS } from "../../labels";

const COUNT_FORMATTER = new Intl.NumberFormat();
const PLURAL_RULES = new Intl.PluralRules();

function plural(count: number, one: string, other: string): string {
  return PLURAL_RULES.select(count) === "one" ? one : other;
}

function characters(count: number): string {
  return `${COUNT_FORMATTER.format(count)} ${plural(
    count,
    EXPLORER_LABELS.documentHistoryCharacterOne,
    EXPLORER_LABELS.documentHistoryCharacterOther,
  )}`;
}

/** `firstName` and `postal_code` read as "first name" and "postal code". */
function readableKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .trim()
    .toLowerCase();
}

function readableKeys(keys: ReadonlyArray<string>): string {
  return keys.map(readableKey).join(", ");
}

function describeText(text: DocumentHistoryChange["text"]): string[] {
  if (text === null) return [];
  if (text.insertedLength > 0 && text.removedLength > 0) {
    return [
      `${EXPLORER_LABELS.documentHistoryTextReplaced} ${characters(
        text.removedLength,
      )} ${EXPLORER_LABELS.documentHistoryTextReplacedWith} ${COUNT_FORMATTER.format(
        text.insertedLength,
      )}`,
    ];
  }
  return [
    text.insertedLength > 0
      ? `${EXPLORER_LABELS.documentHistoryTextAdded} ${characters(text.insertedLength)}`
      : `${EXPLORER_LABELS.documentHistoryTextRemoved} ${characters(text.removedLength)}`,
  ];
}

function describeRows(rows: DocumentHistoryChange["rows"]): string[] {
  const lines: string[] = [];
  if (rows.added.length > 0) {
    lines.push(
      plural(
        rows.added.length,
        EXPLORER_LABELS.documentHistoryRowsAddedOne,
        EXPLORER_LABELS.documentHistoryRowsAddedOther,
      ),
    );
  }
  if (rows.changed.length > 0) {
    const cells = [...new Set(rows.changed.flatMap((row) => row.fields))];
    lines.push(
      `${plural(
        rows.changed.length,
        EXPLORER_LABELS.documentHistoryRowsChangedOne,
        EXPLORER_LABELS.documentHistoryRowsChangedOther,
      )} (${readableKeys(cells)})`,
    );
  }
  if (rows.removed.length > 0) {
    lines.push(
      plural(
        rows.removed.length,
        EXPLORER_LABELS.documentHistoryRowsRemovedOne,
        EXPLORER_LABELS.documentHistoryRowsRemovedOther,
      ),
    );
  }
  return lines;
}

function describeAttachments(
  attachments: DocumentHistoryChange["attachments"],
): string[] {
  const lines: string[] = [];
  if (attachments.added.length > 0) {
    lines.push(
      plural(
        attachments.added.length,
        EXPLORER_LABELS.documentHistoryAttachmentsAddedOne,
        EXPLORER_LABELS.documentHistoryAttachmentsAddedOther,
      ),
    );
  }
  if (attachments.replaced.length > 0) {
    lines.push(
      plural(
        attachments.replaced.length,
        EXPLORER_LABELS.documentHistoryAttachmentsReplacedOne,
        EXPLORER_LABELS.documentHistoryAttachmentsReplacedOther,
      ),
    );
  }
  if (attachments.removed.length > 0) {
    lines.push(
      plural(
        attachments.removed.length,
        EXPLORER_LABELS.documentHistoryAttachmentsRemovedOne,
        EXPLORER_LABELS.documentHistoryAttachmentsRemovedOther,
      ),
    );
  }
  return lines;
}

/** One short phrase per kind of change a stop made, in reading order. */
export function describeDocumentHistoryChange(
  change: DocumentHistoryChange,
): string[] {
  if (isEmptyDocumentHistoryChange(change)) {
    return [EXPLORER_LABELS.documentHistoryNoVisibleChange];
  }
  return [
    ...(change.kindChanged ? [EXPLORER_LABELS.documentHistoryKindChanged] : []),
    ...describeText(change.text),
    ...(change.fields.length > 0
      ? [
          `${EXPLORER_LABELS.documentHistoryFieldsChanged} ${readableKeys(change.fields)}`,
        ]
      : []),
    ...describeRows(change.rows),
    ...describeAttachments(change.attachments),
  ];
}
