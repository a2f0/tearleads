import { useMemo, useState } from "react";
import type { PaneLogEntry } from "./PaneLog";

const LOCKED_PANE_LOG_MESSAGE =
  "Unlock the local keychain to restore this pane.";
// Stable empty result so the no-prompt case keeps a constant reference across
// renders rather than handing PaneLog a fresh [] each time the memo recomputes.
const EMPTY_ENTRIES: readonly PaneLogEntry[] = [];

/**
 * Shared trailing pane-log prompt used by both pane shells (windowed and
 * routed). While the pane has no signing key pair it appends a single prompt
 * telling the user how to boot it; once a key pair exists the prompt is
 * dropped. The boot message differs per shell, so it is passed in.
 */
export function useBootPaneLogEntries(input: {
  readonly bootMessage: string;
  readonly hasSigningKeyPair: boolean;
  readonly paneLocked: boolean;
}): readonly PaneLogEntry[] {
  const { bootMessage, hasSigningKeyPair, paneLocked } = input;

  // Stamp the timestamp only when the inputs actually change. useMemo is not a
  // semantic guarantee (React may recompute it), so Date.now() inside it could
  // drift on a spurious recompute. Derive the stamp via the set-state-during-
  // render pattern instead of mutating a ref in render, which is unsafe under
  // concurrent/Strict Mode (an aborted render would persist the mutation).
  const [stamped, setStamped] = useState(() => ({
    bootMessage,
    hasSigningKeyPair,
    paneLocked,
    timestamp: Date.now(),
  }));
  if (
    stamped.bootMessage !== bootMessage ||
    stamped.hasSigningKeyPair !== hasSigningKeyPair ||
    stamped.paneLocked !== paneLocked
  ) {
    setStamped({
      bootMessage,
      hasSigningKeyPair,
      paneLocked,
      timestamp: Date.now(),
    });
  }

  return useMemo(() => {
    if (hasSigningKeyPair) {
      return EMPTY_ENTRIES;
    }
    return [
      {
        id: "boot-pane-prompt",
        level: "info" as const,
        timestamp: stamped.timestamp,
        message: paneLocked ? LOCKED_PANE_LOG_MESSAGE : bootMessage,
      },
    ];
  }, [bootMessage, hasSigningKeyPair, paneLocked, stamped.timestamp]);
}
