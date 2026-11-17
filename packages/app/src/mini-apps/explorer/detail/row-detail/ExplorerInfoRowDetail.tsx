import { type ReactNode, useEffect, useState } from "react";
import {
  MiniAppButton,
  MiniAppCopyValue,
  MiniAppDetailModal,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppKeyValueList,
  MiniAppKeyValueRow,
  MiniAppTableActionButton,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";

const EMPTY_VALUE = "-";

export interface ExplorerInfoRowDetailField {
  /** An id or hash: shown whole, and tapped or clicked to copy. */
  copyable?: boolean | undefined;
  id: string;
  label: string;
  value: string | null | undefined;
}

/** Everything one Get Info table row holds, as its detail dialog shows it. */
export interface ExplorerInfoRowDetail {
  /** Where the row leads, when it leads somewhere (an attachment's blob). */
  action?: { label: string; run: () => void } | undefined;
  fields: ReadonlyArray<ExplorerInfoRowDetailField>;
  title: string;
}

/** How one row opens its detail. */
export interface ExplorerInfoRowDetailOpeners {
  /** For the row's button, which a keyboard or screen reader activates. */
  openFromControl: () => void;
  /** For a click anywhere on the row; ignored when it ends a text selection. */
  openFromRow: () => void;
}

/** A timestamp as its row shows it, then exactly as recorded. */
export function formatExplorerInfoRowDetailTime(
  value: string | null | undefined,
): string | null {
  return value ? `${formatMiniAppDateTime(value)} (${value})` : null;
}

function ExplorerInfoRowDetailOverlay(params: {
  detail: ExplorerInfoRowDetail;
  onClose: () => void;
}) {
  const { detail, onClose } = params;
  const { action } = detail;

  return (
    <MiniAppDetailModal
      actions={
        action ? (
          <MiniAppButton
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.label}
          </MiniAppButton>
        ) : null
      }
      onClose={onClose}
      title={detail.title}
    >
      <MiniAppKeyValueList>
        {detail.fields.map((field) => (
          <MiniAppKeyValueRow key={field.id} label={field.label}>
            {field.copyable ? (
              <MiniAppCopyValue
                display={field.value || EMPTY_VALUE}
                label={field.label}
                value={field.value}
              />
            ) : (
              field.value || EMPTY_VALUE
            )}
          </MiniAppKeyValueRow>
        ))}
      </MiniAppKeyValueList>
    </MiniAppDetailModal>
  );
}

/**
 * A drag that selected a cell's text ends in a click on the row. That click
 * belongs to the selection, not to the row's detail.
 */
function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/**
 * The detail dialog for a Get Info table: a folded phone row truncates or
 * drops values the wide columns show, and both leave full ids in tooltips a
 * touch screen never shows. Tapping a row opens its fields as a key/value
 * list, where nothing is truncated and ids copy.
 *
 * The open row is held by key and read from the current `rows`, so the dialog
 * follows a row that refreshes underneath it and closes with one that is gone.
 */
export function useExplorerInfoRowDetail<TRow>(params: {
  getDetail: (row: TRow) => ExplorerInfoRowDetail;
  getKey: (row: TRow) => string;
  rows: ReadonlyArray<TRow>;
}): {
  detailOverlay: ReactNode;
  getRowDetailOpeners: (row: TRow) => ExplorerInfoRowDetailOpeners;
} {
  const { getDetail, getKey, rows } = params;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openRow =
    openKey === null ? undefined : rows.find((row) => getKey(row) === openKey);
  const missing = openKey !== null && openRow === undefined;

  useEffect(() => {
    if (missing) {
      setOpenKey(null);
    }
  }, [missing]);

  return {
    detailOverlay:
      openRow === undefined ? null : (
        <ExplorerInfoRowDetailOverlay
          detail={getDetail(openRow)}
          onClose={() => setOpenKey(null)}
        />
      ),
    getRowDetailOpeners: (row) => ({
      openFromControl: () => setOpenKey(getKey(row)),
      openFromRow: () => {
        if (!hasTextSelection()) {
          setOpenKey(getKey(row));
        }
      },
    }),
  };
}

/**
 * The row's leading value as the control that opens its detail. The row takes
 * the same action for a pointer anywhere on it; this is the focusable, named
 * control a keyboard or screen reader reaches.
 */
export function ExplorerInfoRowDetailButton(params: {
  onOpen: () => void;
  text: string;
  title?: string | undefined;
}) {
  return (
    <MiniAppTableActionButton aria-haspopup="dialog" onClick={params.onOpen}>
      <MiniAppTableText title={params.title}>{params.text}</MiniAppTableText>
    </MiniAppTableActionButton>
  );
}
