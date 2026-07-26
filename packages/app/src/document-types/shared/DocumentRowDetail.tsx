import { useEffect, useId, useRef } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppModalBackdrop,
  MiniAppModalPanel,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
} from "../../components/mini-app/MiniAppTable";
import { formatRowByline, formatWriterLabel } from "./rowAttribution";
import "./DocumentRowDetail.css";

const ROW_DETAIL_EMPTY_VALUE = "None";

export interface RowDetailField {
  label: string;
  value: string;
  // The verified writer (userId) of this cell's current value, or null when the
  // cell's editor could not be resolved (e.g. attribution not yet synced).
  writerUserId: string | null;
}

// A read-only, per-row drill-down modal — the document Get Info panel scoped to
// one row. Lists each field's value with its verified last editor when known,
// plus the row's created/updated history. Presentational: the caller resolves
// writers (via the row-writer resolver) and passes labels/values in, so both
// document types with different field sets reuse it.
//
// Pass `showFieldValues={false}` to render a pure attribution view — each field
// shows only its last editor, not the value (e.g. a "who set what" drill-down).
export function DocumentRowDetailOverlay(params: {
  title: string;
  fields: ReadonlyArray<RowDetailField>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  currentAuthorId: string | null;
  showFieldValues?: boolean;
  onClose: () => void;
}) {
  const {
    title,
    fields,
    createdAt,
    createdBy,
    updatedAt,
    updatedBy,
    currentAuthorId,
    showFieldValues = true,
    onClose,
  } = params;
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the overlay on open and restore it to the triggering row
  // action on close, so keyboard focus is never dropped to the document body.
  // The active element is narrowed with instanceof (not a cast) so `.focus()`
  // is only called on something that actually has it.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const created = formatRowByline({
    at: createdAt,
    by: createdBy,
    currentAuthorId,
  });
  const updated = formatRowByline({
    at: updatedAt,
    by: updatedBy,
    currentAuthorId,
  });

  return (
    <MiniAppModalBackdrop
      className="document-row-detail-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <MiniAppModalPanel
        aria-labelledby={titleId}
        aria-modal="true"
        className="document-row-detail-panel"
        role="dialog"
      >
        <h2 className="document-row-detail-title" id={titleId}>
          {title}
        </h2>
        <MiniAppInfoSection heading="Fields">
          <MiniAppKeyValueTable>
            <tbody>
              {fields.map((field) => {
                const writer = formatWriterLabel(
                  field.writerUserId,
                  currentAuthorId,
                );
                const attribution = writer ? `set by ${writer}` : null;
                return (
                  <MiniAppInfoRow key={field.label} label={field.label}>
                    {showFieldValues ? (
                      <span className="document-row-detail-value">
                        {field.value.trim().length > 0
                          ? field.value
                          : ROW_DETAIL_EMPTY_VALUE}
                      </span>
                    ) : null}
                    {showFieldValues ? (
                      attribution ? (
                        <span className="document-row-detail-writer">
                          {attribution}
                        </span>
                      ) : null
                    ) : (
                      <span className="document-row-detail-writer document-row-detail-writer-solo">
                        {attribution ?? "Unknown"}
                      </span>
                    )}
                  </MiniAppInfoRow>
                );
              })}
            </tbody>
          </MiniAppKeyValueTable>
        </MiniAppInfoSection>
        {created || updated ? (
          <MiniAppInfoSection heading="History">
            <MiniAppKeyValueTable>
              <tbody>
                {created ? (
                  <MiniAppInfoRow label="Created">{created}</MiniAppInfoRow>
                ) : null}
                {updated ? (
                  <MiniAppInfoRow label="Updated">{updated}</MiniAppInfoRow>
                ) : null}
              </tbody>
            </MiniAppKeyValueTable>
          </MiniAppInfoSection>
        ) : null}
        <MiniAppActions>
          <MiniAppButton onClick={onClose} ref={closeButtonRef}>
            Close
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
