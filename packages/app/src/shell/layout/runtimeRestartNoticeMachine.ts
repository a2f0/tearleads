/**
 * The runtime restart notice's own steps (#3194). A press first lets open
 * documents write their edits to SQLite, then lets the SDK drain its read
 * windows, then reloads. Edits still unsaved after either wait would be
 * lost, so the notice asks, since native shells ignore the page's unload
 * prompt. `attempt` tags each press, so only its own work moves the notice.
 */
export type RuntimeRestartNoticeStep =
  /** Reload is offered. */
  | { readonly status: "offered" }
  /** Waiting for open documents' edits to reach SQLite. */
  | { readonly status: "saving"; readonly attempt: number }
  /** Edits are still unsaved: a reload now would lose them. */
  | { readonly status: "unsaved"; readonly attempt: number }
  /**
   * The SDK drains its read windows. `discard` when the user already chose
   * to lose unsaved edits, so edits made meanwhile ask nothing more.
   */
  | {
      readonly status: "preparing";
      readonly attempt: number;
      readonly discard: boolean;
    }
  /**
   * The page reloads. `location.reload()` returns before the page unloads,
   * so the notice waits here until the SDK asks for a restart again.
   */
  | { readonly status: "reloading"; readonly attempt: number };

export type RuntimeRestartNoticeEvent =
  | { readonly type: "reloadPressed"; readonly attempt: number }
  /** Attempt `attempt`'s wait for edits ended, `unsaved` if some remain. */
  | {
      readonly type: "settled";
      readonly attempt: number;
      readonly unsaved: boolean;
    }
  /** The user chose to reload and lose the unsaved edits. */
  | { readonly type: "discardConfirmed" }
  /** The user chose to keep the unsaved edits. */
  | { readonly type: "keepConfirmed" }
  /** Attempt `attempt`'s drain ended, `unsaved` if edits are pending now. */
  | {
      readonly type: "prepared";
      readonly attempt: number;
      readonly unsaved: boolean;
    }
  /**
   * The SDK asks for a restart again while attempt `attempt` reloads: its
   * hold ended in a page that was kept, as when a browser's user cancels the
   * unload prompt.
   */
  | { readonly type: "pageKept"; readonly attempt: number };

export const RUNTIME_RESTART_NOTICE_OFFERED: RuntimeRestartNoticeStep = {
  status: "offered",
};

export function transitionRuntimeRestartNotice(
  current: RuntimeRestartNoticeStep,
  event: RuntimeRestartNoticeEvent,
): RuntimeRestartNoticeStep {
  switch (event.type) {
    case "reloadPressed":
      return current.status === "offered"
        ? { attempt: event.attempt, status: "saving" }
        : current;
    case "discardConfirmed":
      return current.status === "unsaved"
        ? { attempt: current.attempt, discard: true, status: "preparing" }
        : current;
    case "keepConfirmed":
      return current.status === "unsaved"
        ? RUNTIME_RESTART_NOTICE_OFFERED
        : current;
    default:
      return current.status !== "offered" && current.attempt === event.attempt
        ? finishAttemptWork(current, event)
        : current;
  }
}

/** The current attempt's own work ended: its wait, its drain, or its reload. */
function finishAttemptWork(
  current: Exclude<RuntimeRestartNoticeStep, { status: "offered" }>,
  event: Extract<
    RuntimeRestartNoticeEvent,
    { type: "settled" | "prepared" | "pageKept" }
  >,
): RuntimeRestartNoticeStep {
  const { attempt } = current;
  if (event.type === "settled" && current.status === "saving") {
    return event.unsaved
      ? { attempt, status: "unsaved" }
      : { attempt, discard: false, status: "preparing" };
  }
  if (event.type === "prepared" && current.status === "preparing") {
    return event.unsaved && !current.discard
      ? { attempt, status: "unsaved" }
      : { attempt, status: "reloading" };
  }
  return event.type === "pageKept" && current.status === "reloading"
    ? RUNTIME_RESTART_NOTICE_OFFERED
    : current;
}
