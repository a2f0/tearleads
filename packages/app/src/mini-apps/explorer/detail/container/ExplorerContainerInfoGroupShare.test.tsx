import { afterEach, expect, test } from "bun:test";
import type { ContainerInfo } from "@tearleads/client-sdk";
import { GroupShareNameMismatchError } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  within,
} from "@testing-library/react";
import { createElement, type FormEvent } from "react";
import {
  getFoldedSecondaryTexts,
  mockPhoneRoutedLayout,
} from "../../../../../test/helpers/compactTableFold";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoInheritedGrantSource,
} from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import { ExplorerContainerInfoPrincipalGrantsSection } from "./ExplorerContainerInfoSharingSections";
import { useExplorerContainerInfoGroupShare } from "./ExplorerContainerInfoState";
import type { ReloadExplorerContainerInfo } from "./explorerContainerInfoStateHelpers";

const TEST_SHARE_SCOPE = {
  domainScope: {},
  organizationId: "org-1",
  signingFingerprint: "fingerprint-1",
  userId: "user-1",
};

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
      shareScope: TEST_SHARE_SCOPE,
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
      shareScope: TEST_SHARE_SCOPE,
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
      shareScope: TEST_SHARE_SCOPE,
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
      shareScope: TEST_SHARE_SCOPE,
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
        shareScope: TEST_SHARE_SCOPE,
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

// The share callback can outlive an organization switch, so the captured
// session, not the callback, decides: a switch while the busy panel paints
// must stop the share rather than run it against the replacement runtime.
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
    const shareWithGroup = async (containerId: string): Promise<boolean> => {
      shareCalls.push(containerId);
      return true;
    };
    const view = renderHook(
      (props: { organizationId: string }) =>
        useExplorerContainerInfoGroupShare({
          canShareContainer: true,
          shareScope: {
            ...TEST_SHARE_SCOPE,
            organizationId: props.organizationId,
          },
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
          shareWithGroup,
        }),
      { initialProps: { organizationId: "org-1" } },
    );

    let pending: Promise<void> | undefined;
    act(() => {
      pending = view.result.current(createSubmitEvent());
    });
    view.rerender({ organizationId: "org-2" });

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

function createGrantRemoteInfo(): NonNullable<ContainerInfo["remoteInfo"]> {
  return {
    grantRows: [
      {
        accessLevel: "write",
        inherited: true,
        sourceContainerId: "container-parent",
        subjectId: "group-1",
        subjectType: "group",
      },
    ],
    grants: [],
    groups: [
      {
        createdAt: "2026-05-18T00:00:00.000Z",
        currentState: {
          keyEpoch: 1,
          keyFingerprint: "group-1-key-fingerprint",
          memberCount: 1,
          stateHash: "group-1-state",
          version: 1,
        },
        groupId: "group-1",
        isBuiltin: false,
        name: "Writers",
        nameUnreadable: false,
        organizationId: "org-1",
      },
    ],
    syncCursors: [],
  };
}

// On a phone the grant table folds Type · Permission · Source into one muted
// line under the principal; the row must still open Org Manager and the kebab.
test("folded grant rows keep type, permission, and source, and still open Org Manager", () => {
  const restoreLayout = mockPhoneRoutedLayout();
  const opened: Array<{
    containerId: string;
    position?: MiniAppWindowPosition;
  }> = [];
  try {
    const view = render(
      createElement(ExplorerContainerInfoPrincipalGrantsSection, {
        containerNamesById: new Map([["container-parent", "Projects"]]),
        onOpenGrant: (grant, position) => {
          opened.push({
            containerId: grant.containerId,
            ...(position ? { position } : {}),
          });
        },
        remoteInfo: createGrantRemoteInfo(),
        resolveUserLabel: undefined,
      }),
    );
    const table = view.getByRole("table", {
      name: EXPLORER_LABELS.containerInfoPrincipalGrantsHeading,
    });

    // One summary column plus the kebab column.
    expect(table.querySelectorAll("thead th")).toHaveLength(2);
    expect(within(table).getByText("Writers")).toBeTruthy();
    const details = [
      EXPLORER_LABELS.containerInfoSubjectTypeGroup,
      EXPLORER_LABELS.containerInfoPermissionWrite,
      getExplorerContainerInfoInheritedGrantSource("Projects"),
    ].join(" · ");
    expect(getFoldedSecondaryTexts(table)).toEqual([
      [
        `${EXPLORER_LABELS.containerInfoTypeColumn} · ${EXPLORER_LABELS.containerInfoPermissionColumn} · ${EXPLORER_LABELS.containerInfoSourceColumn}: ${details}`,
      ],
    ]);
    expect(within(table).getByTitle("container-parent")).toBeTruthy();

    const row = within(table).getByRole("button", { name: /^Writers/ });
    fireEvent.click(row, { clientX: 40, clientY: 50 });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(opened).toEqual([
      { containerId: "container-parent", position: { x: 56, y: 66 } },
      { containerId: "container-parent", position: { x: 16, y: 16 } },
    ]);

    fireEvent.click(
      view.getByRole("button", {
        name: `${EXPLORER_LABELS.itemActionsButtonPrefix} Writers`,
      }),
    );
    expect(opened).toHaveLength(2);
    expect(view.getByRole("button", { name: "Open" })).toBeTruthy();
  } finally {
    restoreLayout();
  }
});
