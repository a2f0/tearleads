import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";

// Shared boot-failure surface for Explorer's two gates (the detail panel and the
// sidebar tree). When the local SQLite database fails to start — e.g. an offline
// reload where the worker / sqlite3.wasm could not load — both gates would
// otherwise keep showing "Loading...": their `ready` flag stays false on a hard
// failure exactly as it does mid-boot, so the error is indistinguishable from
// "still loading" and Explorer spins forever. Rendering this instead makes the
// failure visible and offers a Retry that re-attempts the boot.
export function ExplorerDatabaseErrorStatus({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <MiniAppStatus tone="error">
      Couldn't open the local database.{" "}
      <MiniAppButton onClick={onRetry}>Retry</MiniAppButton>
    </MiniAppStatus>
  );
}
