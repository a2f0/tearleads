import { expect, test } from "bun:test";
import { peerPaneLabel, selfPaneLabel } from "./paneLabels";

test("selfPaneLabel maps left to Peer 1 and right to Peer 2", () => {
  expect(selfPaneLabel("left")).toBe("Peer 1");
  expect(selfPaneLabel("right")).toBe("Peer 2");
});

test("peerPaneLabel returns the opposite pane's label", () => {
  expect(peerPaneLabel("left")).toBe("Peer 2");
  expect(peerPaneLabel("right")).toBe("Peer 1");
});
