import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type FormEvent, type ReactNode, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import { classNames } from "../../components/shared/classNames";
import { useClearPendingOnUnmount } from "./usePendingTrackerEntry";
import type { AddTrackerRow } from "./useSavedTrackerRows";

export function TrackerQuickAdd<
  Entry extends Record<keyof Entry, string>,
>(params: {
  addLabel: string;
  className: string;
  controlsDisabled: boolean;
  emptyEntry: Entry;
  isValid: (entry: Entry) => boolean;
  onAddEntry: AddTrackerRow<Entry>;
  onPendingChange: (pending: boolean) => void;
  renderFields: (
    entry: Entry,
    onChange: (field: keyof Entry, value: string) => void,
  ) => ReactNode;
  saveLabel: string;
}) {
  const {
    addLabel,
    className,
    controlsDisabled,
    emptyEntry,
    isValid,
    onAddEntry,
    onPendingChange,
    renderFields,
    saveLabel,
  } = params;
  const [entry, setEntry] = useState(emptyEntry);
  const [open, setOpen] = useState(false);
  const valid = isValid(entry);

  useClearPendingOnUnmount(onPendingChange);

  function close() {
    setEntry(emptyEntry);
    setOpen(false);
    onPendingChange(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled || !valid) {
      return;
    }

    void onAddEntry(entry);
    close();
  }

  if (!open) {
    return (
      <MiniAppButton
        className="tracker-add-button"
        withIcon
        disabled={controlsDisabled}
        onClick={() => {
          setOpen(true);
          onPendingChange(true);
        }}
      >
        <PlusIcon aria-hidden size={14} />
        {addLabel}
      </MiniAppButton>
    );
  }

  return (
    <form
      className={classNames("tracker-edit-row", className)}
      onSubmit={submit}
    >
      {renderFields(entry, (field, value) =>
        setEntry((current) => ({ ...current, [field]: value })),
      )}
      <div className="tracker-quick-add-actions">
        <MiniAppButton
          withIcon
          disabled={controlsDisabled || !valid}
          type="submit"
        >
          <CheckIcon aria-hidden size={14} />
          {saveLabel}
        </MiniAppButton>
        <MiniAppButton withIcon onClick={close}>
          <XIcon aria-hidden size={14} />
          Cancel
        </MiniAppButton>
      </div>
    </form>
  );
}
