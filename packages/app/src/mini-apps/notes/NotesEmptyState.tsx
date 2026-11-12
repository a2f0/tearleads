import {
  MiniAppRoot,
  MiniAppStatePanel,
} from "../../components/mini-app/MiniAppLayout";
import { NOTES_LABELS } from "./labels";

export function NotesEmptyState() {
  return (
    <MiniAppRoot padding="none">
      <MiniAppStatePanel busy title={NOTES_LABELS.emptyStateLoading} />
    </MiniAppRoot>
  );
}
