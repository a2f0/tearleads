import { afterEach, expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
import { useExplorerContainerInfoGroupShare } from "./ExplorerContainerInfoState";
import type { ReloadExplorerContainerInfo } from "./explorerContainerInfoStateHelpers";

function createSubmitEvent(): FormEvent<HTMLFormElement> {
  return { preventDefault: () => undefined } as FormEvent<HTMLFormElement>;
}

afterEach(() => {
  cleanup();
});

test("useExplorerContainerInfoGroupShare requires a draft group", async () => {
  const panelErrors: Array<string | null> = [];
  const shareCalls: string[] = [];
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      canShareContainer: true,
      containerId: "container-1",
      draftShareAccessLevel: "write",
      draftShareGroupId: "",
      isSubmitting: false,
      reloadContainerInfo: async () => undefined,
      setIsSubmitting: () => undefined,
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async (_containerId, groupId) => {
        shareCalls.push(groupId);
        return true;
      },
    }),
  );

  await act(async () => {
    await view.result.current(createSubmitEvent());
  });

  expect(panelErrors).toEqual(["Choose a group."]);
  expect(shareCalls).toEqual([]);
});

// The chosen label is what the SDK checks against the signed group name; a
// picker entry that has gone stale must not submit with the id alone.
test("useExplorerContainerInfoGroupShare requires the chosen group's name", async () => {
  const panelErrors: Array<string | null> = [];
  const shareCalls: string[] = [];
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      canShareContainer: true,
      containerId: "container-1",
      draftShareAccessLevel: "write",
      draftShareGroupId: "group-1",
      isSubmitting: false,
      reloadContainerInfo: async () => undefined,
      setIsSubmitting: () => undefined,
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async (_containerId, groupId) => {
        shareCalls.push(groupId);
        return true;
      },
    }),
  );

  await act(async () => {
    await view.result.current(createSubmitEvent());
  });

  // The picker still shows the selection, so the message names the stale
  // group rather than asking for one as if none were chosen.
  expect(panelErrors).toEqual([
    "The chosen group is no longer available. Choose another group.",
  ]);
  expect(shareCalls).toEqual([]);
});

// The SDK refuses to wrap for a group whose signed name is not the label the
// user chose. That refusal gets its own message instead of the generic one.
test("useExplorerContainerInfoGroupShare names a signed-name mismatch", async () => {
  const panelErrors: Array<string | null> = [];
  let reloads = 0;
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      canShareContainer: true,
      containerId: "container-1",
      draftShareAccessLevel: "write",
      draftShareGroupId: "group-1",
      draftShareGroupName: "Executives",
      isSubmitting: false,
      reloadContainerInfo: async () => {
        reloads += 1;
      },
      setIsSubmitting: () => undefined,
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async () => {
        throw new KeyingVerificationError(
          "object_mismatch",
          "Container share group name does not match the signed group policy",
        );
      },
    }),
  );

  await act(async () => {
    await view.result.current(createSubmitEvent());
  });

  expect(panelErrors.at(-1)).toBe(
    "The chosen group's name does not match its signed policy. Nothing was shared; reload and choose again.",
  );
  expect(reloads).toBe(0);
});

test("useExplorerContainerInfoGroupShare reloads with an optimistic grant", async () => {
  let reloadOptions: Parameters<ReloadExplorerContainerInfo>[0];
  const submittingStates: boolean[] = [];
  const panelErrors: Array<string | null> = [];
  const shareCalls: Array<{
    accessLevel: string;
    containerId: string;
    groupId: string;
  }> = [];
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      canShareContainer: true,
      containerId: "container-1",
      draftShareAccessLevel: "admin",
      draftShareGroupId: "group-1",
      draftShareGroupName: "Group One",
      isSubmitting: false,
      reloadContainerInfo: async (options) => {
        reloadOptions = options;
      },
      setIsSubmitting: (value) => {
        submittingStates.push(value);
      },
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async (containerId, groupId, accessLevel) => {
        shareCalls.push({ accessLevel, containerId, groupId });
        return true;
      },
    }),
  );

  await act(async () => {
    await view.result.current(createSubmitEvent());
  });

  expect(shareCalls).toEqual([
    {
      accessLevel: "admin",
      containerId: "container-1",
      groupId: "group-1",
    },
  ]);
  expect(reloadOptions).toEqual({
    optimisticGrant: {
      accessLevel: "admin",
      subjectId: "group-1",
      subjectType: "group",
    },
  });
  expect(panelErrors).toEqual([null]);
  expect(submittingStates).toEqual([true, false]);
});
