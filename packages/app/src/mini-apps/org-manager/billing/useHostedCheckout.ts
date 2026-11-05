import { useCallback, useRef, useState } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  type HostedCheckoutEvent,
  type HostedCheckoutState,
  IDLE_HOSTED_CHECKOUT,
  transitionHostedCheckout,
} from "./hostedCheckoutState";

/**
 * The off-site alternative to the inline form: mints a hosted Stripe Checkout
 * session and opens it in a NEW tab, so the buyer keeps this billing panel open
 * behind it. The session's success/cancel URLs return to this page.
 *
 * The tab is opened SYNCHRONOUSLY on the click — before the `await` — because a
 * `window.open` issued after an await is treated as programmatic and blocked by
 * pop-up blockers. The blank tab holds the user gesture and is pointed at the
 * minted URL once it resolves; if the pop-up was blocked (no handle), the
 * current tab navigates instead so the buyer is never stranded.
 *
 * A null/failed result would otherwise reset the link silently, leaving a
 * dead-feeling click — e.g. a co-admin whose org is already checking out, or
 * an unconfigured integration — so it moves to `unavailable`, which shows a
 * brief notice until the next click.
 */
export function useHostedCheckout(organizationId: string): {
  readonly open: () => void;
  readonly busy: boolean;
  readonly unavailable: boolean;
} {
  const tearleads = useTearleads();
  const { logError } = useLog();
  // The ref is the machine; the state copy renders it. A second click that
  // lands before React re-renders reads the ref, so it cannot mint a second
  // session or open a second tab.
  const machine = useRef<HostedCheckoutState>(IDLE_HOSTED_CHECKOUT);
  const [state, setState] = useState(IDLE_HOSTED_CHECKOUT);
  const send = useCallback((event: HostedCheckoutEvent): boolean => {
    const previous = machine.current;
    const next = transitionHostedCheckout(previous, event);
    machine.current = next;
    setState(next);
    return next !== previous;
  }, []);
  const open = useCallback(() => {
    if (!send({ type: "open" })) {
      return;
    }
    const tab = globalThis.open?.("about:blank", "_blank");
    void (async () => {
      try {
        const result =
          await tearleads.organizations.createStripeCheckoutSession(
            globalThis.location?.href ?? "",
            organizationId,
          );
        if (result?.url) {
          if (tab) {
            // Sever the child's back-reference before it navigates
            // cross-origin, so the Stripe page cannot reach into this window
            // (reverse tabnabbing); the blank tab is still same-origin here.
            tab.opener = null;
            tab.location.href = result.url;
          } else {
            // The pop-up was blocked: fall back to same-tab navigation rather
            // than leaving the click dead.
            globalThis.location?.assign(result.url);
          }
          send({ type: "opened" });
          return;
        }
        // Unconfigured, not eligible, or a checkout already in progress.
        tab?.close();
        send({ type: "declined" });
      } catch (error) {
        logError("Failed to open the hosted Stripe checkout", error);
        tab?.close();
        send({ type: "declined" });
      }
    })();
  }, [logError, organizationId, send, tearleads]);
  return {
    open,
    busy: state.status === "opening",
    unavailable: state.status === "unavailable",
  };
}
