import {
  getRuntimeHealth,
  prepareRuntimeRestart,
  type RuntimeHealthStatus,
  subscribeRuntimeHealth,
} from "@tearleads/client-sdk";
import { useEffect, useReducer, useRef } from "react";
import { hasPendingPageDocumentWrites } from "../../providers/db/pageDocumentWrites";
import { useTearleadsExternalValue } from "../../providers/sdk/useTearleadsSubscription";
import {
  RUNTIME_RESTART_NOTICE_OFFERED,
  type RuntimeRestartNoticeStep,
  transitionRuntimeRestartNotice,
} from "./runtimeRestartNoticeMachine";
import "./RuntimeRestartNotice.css";

export const RUNTIME_RESTART_LABELS = {
  discard: "Reload anyway",
  keep: "Not now",
  message: "A document needs a reload to finish syncing.",
  reload: "Reload",
  reloading: "Reloading…",
  unsaved: "Some edits haven't been saved yet. Reloading now loses them.",
} as const;

/** How long Reload waits for open documents' edits to reach SQLite. */
const SAVE_WAIT_MS = 10_000;
const SAVE_POLL_MS = 100;

/**
 * The notice for a page whose document engine a runtime failure left
 * suspect (#3194): the update that failed waits for a fresh page. Nothing
 * reloads until the user presses Reload, and edits that would be lost are
 * the user's to discard.
 */
export function RuntimeRestartNoticeView({
  onDiscard,
  onKeep,
  onReload,
  status,
  step,
}: {
  readonly onDiscard: () => void;
  readonly onKeep: () => void;
  readonly onReload: () => void;
  readonly status: RuntimeHealthStatus;
  readonly step: RuntimeRestartNoticeStep["status"];
}) {
  if (status === "healthy") {
    return null;
  }
  if (step === "unsaved") {
    return (
      <div className="runtime-restart-notice" role="status">
        <span>{RUNTIME_RESTART_LABELS.unsaved}</span>
        <button
          className="runtime-restart-notice-button"
          onClick={onDiscard}
          type="button"
        >
          {RUNTIME_RESTART_LABELS.discard}
        </button>
        <button onClick={onKeep} type="button">
          {RUNTIME_RESTART_LABELS.keep}
        </button>
      </div>
    );
  }
  const busy = status === "draining" || step !== "offered";
  return (
    <div className="runtime-restart-notice" role="status">
      <span>{RUNTIME_RESTART_LABELS.message}</span>
      <button
        className="runtime-restart-notice-button"
        disabled={busy}
        onClick={onReload}
        type="button"
      >
        {busy
          ? RUNTIME_RESTART_LABELS.reloading
          : RUNTIME_RESTART_LABELS.reload}
      </button>
    </div>
  );
}

/** The SDK's runtime health and restart, and the page's edits; tests pass their own. */
export interface RuntimeRestartSource {
  readonly getStatus: () => RuntimeHealthStatus;
  readonly hasPendingWrites: () => boolean;
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
  hasPendingWrites: () => hasPendingPageDocumentWrites(),
  prepare: () => prepareRuntimeRestart(),
  reload: () => window.location.reload(),
  subscribe: (listener) => subscribeRuntimeHealth(listener),
};

/** Waits up to `waitMs` for no edit to be pending; true if some still are. */
async function waitForSavedEdits(
  hasPendingWrites: () => boolean,
  waitMs: number,
  cancelled: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (hasPendingWrites() && Date.now() < deadline && !cancelled()) {
    await new Promise((resolve) => setTimeout(resolve, SAVE_POLL_MS));
  }
  return hasPendingWrites();
}

/**
 * Shows the notice while the SDK asks for a restart, and runs a press
 * through `transitionRuntimeRestartNotice`: entering `saving` waits for
 * edits to reach SQLite, and entering `reloading` lets the SDK drain its
 * read windows (`prepareRuntimeRestart`) before the reload.
 */
export function RuntimeRestartNotice({
  saveWaitMs = SAVE_WAIT_MS,
  source = SDK_RUNTIME_RESTART,
}: {
  readonly saveWaitMs?: number;
  readonly source?: RuntimeRestartSource;
}) {
  const status = useTearleadsExternalValue(source.subscribe, source.getStatus);
  const [step, dispatch] = useReducer(
    transitionRuntimeRestartNotice,
    RUNTIME_RESTART_NOTICE_OFFERED,
  );
  const attempts = useRef(0);
  useEffect(() => {
    // A run this effect has left (a new step, source, or unmount) acts no
    // further, so a press reloads at most once.
    let cancelled = false;
    const isCancelled = () => cancelled;
    if (step.status === "saving") {
      const { attempt } = step;
      void waitForSavedEdits(
        source.hasPendingWrites,
        saveWaitMs,
        isCancelled,
      ).then((unsaved) => {
        if (!cancelled) dispatch({ attempt, type: "settled", unsaved });
      });
    } else if (step.status === "reloading") {
      const { attempt } = step;
      void source.prepare().then(() => {
        if (cancelled) return;
        source.reload();
        dispatch({ attempt, type: "reloadReturned" });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [step, source, saveWaitMs]);
  return (
    <RuntimeRestartNoticeView
      onDiscard={() => dispatch({ type: "discardConfirmed" })}
      onKeep={() => dispatch({ type: "keepConfirmed" })}
      onReload={() => {
        attempts.current += 1;
        dispatch({ attempt: attempts.current, type: "reloadPressed" });
      }}
      status={status}
      step={step.status}
    />
  );
}
