import { NOTES_LABELS } from "./labels";

export function NotesEmptyState() {
  return (
    <div className="notes notes--empty">{NOTES_LABELS.emptyStateLoading}</div>
  );
}
