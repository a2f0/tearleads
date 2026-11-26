import type { DocumentHistory } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import {
  type DocumentHistoryVerificationEvent,
  type DocumentHistoryVerificationState,
  IDLE_DOCUMENT_HISTORY_VERIFICATION,
  transitionDocumentHistoryVerification,
} from "./documentHistoryVerificationMachine";

export interface DocumentHistoryVerificationControls {
  readonly state: DocumentHistoryVerificationState;
  /** Check the capture against the signed uploads the server holds. */
  readonly verify: () => void;
}

/**
 * The machine, held in a ref so an event sent after the caller unmounted is
 * still judged and its effects still run: a check that comes back late may
 * bring a signed replay that has to be closed. `state` is its copy for
 * rendering.
 */
function useVerificationMachine(): {
  readonly beginRun: () => {
    readonly run: number;
    readonly signal: AbortSignal;
  };
  readonly send: (event: DocumentHistoryVerificationEvent) => void;
  readonly state: DocumentHistoryVerificationState;
} {
  const machine = useRef(IDLE_DOCUMENT_HISTORY_VERIFICATION);
  const [state, setState] = useState(IDLE_DOCUMENT_HISTORY_VERIFICATION);
  const lastRun = useRef(0);
  // One per check, so a stopped check is told at its next page.
  const aborts = useRef(new Map<number, AbortController>());

  const send = useCallback((event: DocumentHistoryVerificationEvent) => {
    const step = transitionDocumentHistoryVerification(machine.current, event);
    machine.current = step.state;
    setState(step.state);
    for (const effect of step.effects) {
      if (effect.type === "close-signed") {
        effect.signed.close();
      } else {
        aborts.current.get(effect.run)?.abort();
      }
    }
    // A check that has come back, stopped or not, has no use for its signal.
    if (event.type === "settled" || event.type === "failed") {
      aborts.current.delete(event.run);
    }
  }, []);

  const beginRun = useCallback(() => {
    lastRun.current += 1;
    const controller = new AbortController();
    aborts.current.set(lastRun.current, controller);
    return { run: lastRun.current, signal: controller.signal };
  }, []);

  return { beginRun, send, state };
}

/**
 * Check a History capture against the signed uploads the server holds, when
 * asked. `capture` is this device's open capture, or null while there is
 * none. A check belongs to the capture it was asked about: when that capture
 * is replaced (History reloads after a restore or "Load newer edits", or the
 * database or account changes) or the caller unmounts, the check in flight is
 * stopped, its verdict forgotten, and a signed replay it brought is closed.
 * The caller must take a signed replay off screen before any of those.
 */
export function useDocumentHistoryVerification(
  localId: string,
  capture: DocumentHistory | null,
): DocumentHistoryVerificationControls {
  const { documents } = useTearleads();
  const { beginRun, send, state } = useVerificationMachine();

  useEffect(
    () => () => send({ type: "capture-changed" }),
    // Run on every change of what a check reads, and on unmount.
    [capture, documents, localId, send],
  );

  const verify = useCallback(() => {
    if (capture === null) return;
    // Read before a run begins: a throw here must not leave one open.
    const captureVersion = capture.versionAt(capture.stops.length - 1);
    const { run, signal } = beginRun();
    send({ captureVersion, run, type: "requested" });
    // A call that throws at once ends in `failed`, as a rejection does.
    const started = () => {
      try {
        return documents.verifyHistory(localId, {
          onProgress: (progress) => send({ progress, run, type: "progressed" }),
          signal,
        });
      } catch (error) {
        return Promise.reject(error);
      }
    };
    started().then(
      (result) => send({ result, run, type: "settled" }),
      (error: unknown) =>
        send({ message: unknownErrorMessage(error), run, type: "failed" }),
    );
  }, [beginRun, capture, documents, localId, send]);

  return { state, verify };
}
