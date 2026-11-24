import {
  getRuntimeHealth,
  prepareRuntimeRestart,
  type RuntimeHealthStatus,
  subscribeRuntimeHealth,
} from "@tearleads/client-sdk";
import { useTearleadsExternalValue } from "../../providers/sdk/useTearleadsSubscription";
import "./RuntimeRestartNotice.css";

export const RUNTIME_RESTART_LABELS = {
  message: "A document needs a reload to finish syncing.",
  reload: "Reload",
  reloading: "Reloading…",
} as const;

/**
 * The notice for a page whose document engine a runtime failure left
 * suspect (#3194): the update that failed waits for a fresh page. Nothing
 * reloads until the user presses Reload. A page the user kept, by
 * cancelling the unload prompt for queued edits, offers Reload again.
 */
export function RuntimeRestartNoticeView({
  onReload,
  status,
}: {
  readonly onReload: () => void;
  readonly status: RuntimeHealthStatus;
}) {
  if (status === "healthy") {
    return null;
  }
  const draining = status === "draining";
  return (
    <div className="runtime-restart-notice" role="status">
      <span>{RUNTIME_RESTART_LABELS.message}</span>
      <button
        className="runtime-restart-notice-button"
        disabled={draining}
        onClick={onReload}
        type="button"
      >
        {draining
          ? RUNTIME_RESTART_LABELS.reloading
          : RUNTIME_RESTART_LABELS.reload}
      </button>
    </div>
  );
}

/** The SDK's runtime health and restart; tests pass their own. */
export interface RuntimeRestartSource {
  readonly getStatus: () => RuntimeHealthStatus;
  readonly prepare: () => Promise<void>;
  readonly reload: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

// Each SDK value is read inside a function body, not at module scope: in the
// Bun dev bundle the SDK root finishes evaluating only after its async Loro
// WASM dependency, so this module, evaluated first, would read its namespace
// as null and crash the app on load (envFileDocumentDefinition.ts).
const SDK_RUNTIME_RESTART: RuntimeRestartSource = {
  getStatus: () => getRuntimeHealth(),
  prepare: () => prepareRuntimeRestart(),
  reload: () => window.location.reload(),
  subscribe: (listener) => subscribeRuntimeHealth(listener),
};

/**
 * Shows the notice while the SDK asks for a restart. Reload first lets the
 * SDK drain its read windows (`prepareRuntimeRestart`); a reload that would
 * lose queued edits still asks first
 * (`useWarnBeforeUnloadWithPendingDocumentWrites`).
 */
export function RuntimeRestartNotice({
  source = SDK_RUNTIME_RESTART,
}: {
  readonly source?: RuntimeRestartSource;
}) {
  const status = useTearleadsExternalValue(source.subscribe, source.getStatus);
  return (
    <RuntimeRestartNoticeView
      onReload={() => {
        void source.prepare().then(source.reload);
      }}
      status={status}
    />
  );
}
