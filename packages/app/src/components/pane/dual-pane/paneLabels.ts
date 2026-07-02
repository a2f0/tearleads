import type { PaneSide } from "./types";

// The two demo panes read as "Peer 1" (left) and "Peer 2" (right). These
// labels are the single source of truth for the desktop pane label, the seeded
// self-contact nickname, the imported peer-contact nickname, and the personal
// org name, so those surfaces never drift. Demo-only: the regular app is
// single-pane and never renders a peer label.

// The label for the pane on `side` itself (the local "you").
export function selfPaneLabel(side: PaneSide): string {
  return side === "left" ? "Peer 1" : "Peer 2";
}

// The label for the OTHER pane, as seen from `side` (the peer to import).
export function peerPaneLabel(side: PaneSide): string {
  return selfPaneLabel(side === "left" ? "right" : "left");
}
