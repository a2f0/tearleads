import { AccountBootstrapLoadingPanel } from "../../components/identity/AccountBootstrapLoadingPanel";
import { MiniAppRoot } from "../../components/mini-app/MiniAppLayout";
import { NOTES_LABELS } from "./labels";

export function NotesEmptyState() {
  return (
    <MiniAppRoot padding="none">
      <AccountBootstrapLoadingPanel title={NOTES_LABELS.emptyStateLoading} />
    </MiniAppRoot>
  );
}
