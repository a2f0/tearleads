import { afterEach, expect, test } from "bun:test";
import { GroupShareNameMismatchError } from "@tearleads/client-sdk";
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
      logError: () => undefined,
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
      logError: () => undefined,
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
  const logged: Array<[string | Error, unknown]> = [];
  let reloads = 0;
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      canShareContainer: true,
      containerId: "container-1",
      draftShareAccessLevel: "write",
      draftShareGroupId: "group-1",
      draftShareGroupName: "Executives",
      isSubmitting: false,
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
      reloadContainerInfo: async () => {
        reloads += 1;
      },
      setIsSubmitting: () => undefined,
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async () => {
        throw new GroupShareNameMismatchError(
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
  // The panel's label names no cause, so the thrown error is logged.
  expect(logged).toHaveLength(1);
  expect(logged[0]?.[1]).toBeInstanceOf(GroupShareNameMismatchError);
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
      logError: () => undefined,
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

// Sharing seals keys on the main thread, so the busy panel must paint before
// the share starts or its spinner never turns.
test("useExplorerContainerInfoGroupShare paints the busy state before sharing", async () => {
  const events: string[] = [];
  const frames: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    events.push("frame-requested");
    frames.push(callback);
    return frames.length;
  };
  try {
    const view = renderHook(() =>
      useExplorerContainerInfoGroupShare({
        canShareContainer: true,
        containerId: "container-1",
        draftShareAccessLevel: "read",
        draftShareGroupId: "group-1",
        draftShareGroupName: "Group One",
        isSubmitting: false,
        logError: () => undefined,
        reloadContainerInfo: async () => undefined,
        setIsSubmitting: (value) => {
          events.push(`submitting:${value}`);
        },
        setPanelError: () => undefined,
        shareWithGroup: async () => {
          events.push("share");
          return true;
        },
      }),
    );

    let pending: Promise<void> | undefined;
    act(() => {
      pending = view.result.current(createSubmitEvent());
    });
    await Promise.resolve();
    expect(events).toEqual(["submitting:true", "frame-requested"]);

    await act(async () => {
      frames.shift()?.(performance.now());
      await pending;
    });
    expect(events).toEqual([
      "submitting:true",
      "frame-requested",
      "share",
      "submitting:false",
    ]);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

// The share callback is bound to the active scope's container store. A scope
// switch while the busy panel paints must stop the captured share instead of
// running it against the replacement runtime.
test("useExplorerContainerInfoGroupShare drops a share whose scope changed during the paint wait", async () => {
  const frames: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  try {
    const shareCalls: string[] = [];
    const submittingStates: boolean[] = [];
    const shareFor =
      (scope: string) =>
      async (_containerId: string, _groupId: string): Promise<boolean> => {
        shareCalls.push(scope);
        return true;
      };
    const shareInScopeA = shareFor("scope-a");
    const shareInScopeB = shareFor("scope-b");
    const view = renderHook(
      (props: { shareWithGroup: typeof shareInScopeA }) =>
        useExplorerContainerInfoGroupShare({
          canShareContainer: true,
          containerId: "container-1",
          draftShareAccessLevel: "read",
          draftShareGroupId: "group-1",
          draftShareGroupName: "Group One",
          isSubmitting: false,
          logError: () => undefined,
          reloadContainerInfo: async () => undefined,
          setIsSubmitting: (value) => {
            submittingStates.push(value);
          },
          setPanelError: () => undefined,
          shareWithGroup: props.shareWithGroup,
        }),
      { initialProps: { shareWithGroup: shareInScopeA } },
    );

    let pending: Promise<void> | undefined;
    act(() => {
      pending = view.result.current(createSubmitEvent());
    });
    view.rerender({ shareWithGroup: shareInScopeB });

    await act(async () => {
      frames.shift()?.(performance.now());
      await pending;
    });
    expect(shareCalls).toEqual([]);
    expect(submittingStates).toEqual([true, false]);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});
