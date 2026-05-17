import { expect, test } from "bun:test";
import {
  getExplorerModalError,
  getExplorerModalLog,
  getExplorerModalSubmitLabel,
  getExplorerModalTitle,
  isExplorerModalSubmitDisabled,
} from "./labels";
import type { ExplorerModalState } from "./types";

const modalFixtures: ReadonlyArray<{
  error: string;
  log: string;
  state: ExplorerModalState;
  submitLabel: string;
  submittingLabel: string;
  title: string;
}> = [
  {
    error: "Failed to create child container.",
    log: "Failed to create child container:",
    state: { mode: "create-child", nodeId: "container-1" },
    submitLabel: "Create",
    submittingLabel: "Creating...",
    title: "Create Child",
  },
  {
    error: "Failed to rename container.",
    log: "Failed to rename container:",
    state: { mode: "rename", nodeId: "container-1" },
    submitLabel: "Rename",
    submittingLabel: "Renaming...",
    title: "Rename Container",
  },
  {
    error: "Failed to delete container.",
    log: "Failed to delete container:",
    state: { mode: "delete", nodeId: "container-1" },
    submitLabel: "Delete",
    submittingLabel: "Deleting...",
    title: "Delete Container",
  },
  {
    error: "Failed to link document.",
    log: "Failed to link document:",
    state: { mode: "link-document", documentLocalId: "note-1" },
    submitLabel: "Link",
    submittingLabel: "Linking...",
    title: "Link Document",
  },
  {
    error: "Failed to move container.",
    log: "Failed to move container:",
    state: { mode: "move", nodeId: "container-1" },
    submitLabel: "Move",
    submittingLabel: "Moving...",
    title: "Move Container",
  },
  {
    error: "Failed to move document.",
    log: "Failed to move document:",
    state: { mode: "move-document", documentLocalId: "note-1" },
    submitLabel: "Move",
    submittingLabel: "Moving...",
    title: "Move Document",
  },
  {
    error: "Failed to share container with peer.",
    log: "Failed to share container with peer:",
    state: { mode: "share-peer", nodeId: "container-1" },
    submitLabel: "Share",
    submittingLabel: "Sharing...",
    title: "Share Container",
  },
];

test("modal labels cover every explorer modal mode", () => {
  for (const fixture of modalFixtures) {
    expect(getExplorerModalError(fixture.state.mode)).toBe(fixture.error);
    expect(getExplorerModalLog(fixture.state.mode)).toBe(fixture.log);
    expect(getExplorerModalTitle(fixture.state)).toBe(fixture.title);
    expect(getExplorerModalSubmitLabel(fixture.state, false)).toBe(
      fixture.submitLabel,
    );
    expect(getExplorerModalSubmitLabel(fixture.state, true)).toBe(
      fixture.submittingLabel,
    );
  }
});

test("submit disabled state enforces mode-specific requirements", () => {
  expect(
    isExplorerModalSubmitDisabled({
      draftName: "Child",
      draftTargetContainerId: "",
      isSubmittingModal: true,
      modalState: { mode: "create-child", nodeId: "container-1" },
      peerUserId: null,
    }),
  ).toBe(true);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "   ",
      draftTargetContainerId: "",
      isSubmittingModal: false,
      modalState: { mode: "rename", nodeId: "container-1" },
      peerUserId: null,
    }),
  ).toBe(true);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "Renamed",
      draftTargetContainerId: "",
      isSubmittingModal: false,
      modalState: { mode: "rename", nodeId: "container-1" },
      peerUserId: null,
    }),
  ).toBe(false);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "",
      draftTargetContainerId: "",
      isSubmittingModal: false,
      modalState: { mode: "delete", nodeId: "container-1" },
      peerUserId: null,
    }),
  ).toBe(false);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "",
      draftTargetContainerId: "",
      isSubmittingModal: false,
      modalState: { mode: "move", nodeId: "container-1" },
      peerUserId: null,
    }),
  ).toBe(true);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "",
      draftTargetContainerId: "target-container",
      isSubmittingModal: false,
      modalState: { mode: "move-document", documentLocalId: "note-1" },
      peerUserId: null,
    }),
  ).toBe(false);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "",
      draftTargetContainerId: "",
      isSubmittingModal: false,
      modalState: { mode: "share-peer", nodeId: "container-1" },
      peerUserId: null,
    }),
  ).toBe(true);

  expect(
    isExplorerModalSubmitDisabled({
      draftName: "",
      draftTargetContainerId: "",
      isSubmittingModal: false,
      modalState: { mode: "share-peer", nodeId: "container-1" },
      peerUserId: "peer-user",
    }),
  ).toBe(false);
});
