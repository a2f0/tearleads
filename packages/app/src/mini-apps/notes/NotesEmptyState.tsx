import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import { NOTES_LABELS } from "./labels";

export function NotesEmptyState() {
  return (
    <MiniAppRoot centered padding="none">
      {NOTES_LABELS.emptyStateLoading}
    </MiniAppRoot>
  );
}
