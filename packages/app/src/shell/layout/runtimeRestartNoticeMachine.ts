/**
 * The runtime restart notice's own steps (#3194). A press first lets open
 * documents write their edits to SQLite, then reloads once the SDK has
 * drained its read windows; edits still unsaved after the wait would be
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
  /** Draining, then reloading; a page its user kept offers Reload again. */
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
  /** Attempt `attempt`'s reload returned: the page is still here. */
  | { readonly type: "reloadReturned"; readonly attempt: number };

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
    case "settled":
      if (current.status !== "saving" || current.attempt !== event.attempt) {
        return current;
      }
      return {
        attempt: current.attempt,
        status: event.unsaved ? "unsaved" : "reloading",
      };
    case "discardConfirmed":
      return current.status === "unsaved"
        ? { attempt: current.attempt, status: "reloading" }
        : current;
    case "keepConfirmed":
      return current.status === "unsaved"
        ? RUNTIME_RESTART_NOTICE_OFFERED
        : current;
    case "reloadReturned":
      return current.status === "reloading" && current.attempt === event.attempt
        ? RUNTIME_RESTART_NOTICE_OFFERED
        : current;
  }
}
