import {
  getRuntimeHealth,
  prepareRuntimeRestart,
  type RuntimeHealthStatus,
  subscribeRuntimeHealth,
} from "@tearleads/client-sdk";
import { useEffect, useReducer, useRef } from "react";
import {
  hasPendingPageDocumentWrites,
  reloadDiscardingPageDocumentWrites,
} from "../../providers/db/pageDocumentWrites";
import { useTearleadsExternalValue } from "../../providers/sdk/useTearleadsSubscription";
import {
  RUNTIME_RESTART_NOTICE_OFFERED,
  type RuntimeRestartNoticeStep,
  transitionRuntimeRestartNotice,
} from "./runtimeRestartNoticeMachine";
import "./RuntimeRestartNotice.css";

export const RUNTIME_RESTART_LABELS = {
  discard: "Reload anyway",
  failed:
    "Couldn't prepare the reload. Reloading anyway may lose unsaved edits.",
  keep: "Not now",
  message: "A document needs a reload to finish syncing.",
  reload: "Reload",
  reloading: "Reloading…",
  retry: "Try again",
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
  if (step === "unsaved" || step === "failed") {
    // Either way the user may reload anyway. Asked about unsaved edits, the
    // user may keep them instead; after a step threw, try the press again.
    const unsaved = step === "unsaved";
    return (
      <div className="runtime-restart-notice" role="status">
        <span>
          {unsaved
            ? RUNTIME_RESTART_LABELS.unsaved
            : RUNTIME_RESTART_LABELS.failed}
        </span>
        <button
          className="runtime-restart-notice-button"
          onClick={onDiscard}
          type="button"
        >
          {RUNTIME_RESTART_LABELS.discard}
        </button>
        <button onClick={unsaved ? onKeep : onReload} type="button">
          {unsaved ? RUNTIME_RESTART_LABELS.keep : RUNTIME_RESTART_LABELS.retry}
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
  /** Reloads the page; `discard` once the user chose to lose unsaved edits. */
  readonly reload: (discard: boolean) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

// Each SDK value is read inside a function body, not at module scope: in the
// Bun dev bundle the SDK root finishes evaluating only after its async Loro
// WASM dependency, so this module, evaluated first, would read its namespace
// as null and crash the app on load (envFileDocumentDefinition.ts).
export const SDK_RUNTIME_RESTART: RuntimeRestartSource = {
  getStatus: () => getRuntimeHealth(),
  hasPendingWrites: () => hasPendingPageDocumentWrites(),
  prepare: () => prepareRuntimeRestart(),
  reload: (discard) => {
    const reload = () => window.location.reload();
    if (discard) reloadDiscardingPageDocumentWrites(reload);
    else reload();
  },
  subscribe: (listener) => subscribeRuntimeHealth(listener),
};

/**
 * Lets the SDK drain its read windows, then tells whether edits are pending
 * now, unless the user already chose to lose them.
 */
async function prepareRestart(
  source: RuntimeRestartSource,
  discard: boolean,
): Promise<boolean> {
  await source.prepare();
  return !discard && source.hasPendingWrites();
}

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
 * edits to reach SQLite, entering `preparing` lets the SDK drain its read
 * windows (`prepareRuntimeRestart`) and asks again about edits, and
 * entering `reloading` reloads the page, once. A step that throws moves the
 * notice to `failed`.
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
  const reloaded = useRef<RuntimeRestartNoticeStep | null>(null);
  useEffect(() => {
    // A run this effect has left (a new step, source, or unmount) acts no
    // further, so only the current source's work moves the notice.
    let cancelled = false;
    const isCancelled = () => cancelled;
    const fail = (attempt: number) => () => {
      if (!cancelled) dispatch({ attempt, type: "failed" });
    };
    if (step.status === "saving") {
      const { attempt } = step;
      void waitForSavedEdits(
        source.hasPendingWrites,
        saveWaitMs,
        isCancelled,
      ).then((unsaved) => {
        if (!cancelled) dispatch({ attempt, type: "settled", unsaved });
      }, fail(attempt));
    } else if (step.status === "preparing") {
      const { attempt } = step;
      void prepareRestart(source, step.discard).then((unsaved) => {
        if (!cancelled) dispatch({ attempt, type: "prepared", unsaved });
      }, fail(attempt));
    } else if (step.status === "reloading" && reloaded.current !== step) {
      reloaded.current = step;
      try {
        source.reload(step.discard);
      } catch {
        fail(step.attempt)();
      }
    }
    return () => {
      cancelled = true;
    };
  }, [step, source, saveWaitMs]);
  useEffect(() => {
    // The SDK asks again only once its hold ended with the page still here.
    if (step.status === "reloading" && status === "restartRequired") {
      dispatch({ attempt: step.attempt, type: "pageKept" });
    }
  }, [step, status]);
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
