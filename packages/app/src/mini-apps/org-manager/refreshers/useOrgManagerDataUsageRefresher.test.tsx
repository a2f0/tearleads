import { afterEach, expect, test } from "bun:test";
import type { OrganizationDataUsage } from "@symcrypt/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import invariant from "invariant";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import type { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import type { DataUsageRefreshOptions } from "../refresh";
import { useOrgManagerDataUsageRefresher } from "./useOrgManagerDataUsageRefresher";

afterEach(() => cleanup());

const USAGE: OrganizationDataUsage = {
  organizationId: "org-a",
  blobs: { blobCount: 1, byteLength: 2 },
  documents: {
    breakdown: [],
    byteLength: 3,
    documentCount: 1,
    updateCount: 1,
  },
  totalByteLength: 5,
};

interface RefreshProbeActions {
  readonly readUsage: () => OrganizationDataUsage | null;
  readonly refresh: (options?: DataUsageRefreshOptions) => Promise<void>;
}

function RefreshProbe(input: {
  readonly capture: (actions: RefreshProbeActions) => void;
  readonly errors: Array<string | null>;
  readonly initialUsage?: OrganizationDataUsage | null;
  readonly loadDataUsage: () => Promise<OrganizationDataUsage | null>;
  readonly onSettled?: (() => void) | undefined;
}) {
  const beginRequest = useOrgManagerRequestGuard("org-a:user-a:db-a");
  const dataUsageRef = useRef<OrganizationDataUsage | null>(
    input.initialUsage === undefined ? USAGE : input.initialUsage,
  );
  const setDataUsage: Dispatch<SetStateAction<OrganizationDataUsage | null>> = (
    next,
  ) => {
    dataUsageRef.current =
      typeof next === "function" ? next(dataUsageRef.current) : next;
  };
  const refresh = useOrgManagerDataUsageRefresher({
    appData: {
      auth: { isAuthenticated: true, organizationId: "org-a" },
    } as ReturnType<typeof useSymCryptRuntime>,
    beginRequest,
    canLoadAuthenticatedOrgData: true,
    dataUsageRef,
    markDataUsageSettled: () => input.onSettled?.(),
    orgManagerActions: {
      loadDataUsage: input.loadDataUsage,
    } as ReturnType<typeof useOrgManagerActions>,
    setDataUsage,
    setError: (next) => {
      input.errors.push(typeof next === "function" ? next(null) : next);
    },
    setLoading: () => {},
  });
  useEffect(() => {
    input.capture({ readUsage: () => dataUsageRef.current, refresh });
  }, [input, refresh]);
  return null;
}

test("a thrown usage refresh retains the painted value", async () => {
  const errors: Array<string | null> = [];
  const captured: { actions: RefreshProbeActions | null } = { actions: null };
  render(
    <RefreshProbe
      capture={(next) => {
        captured.actions = next;
      }}
      errors={errors}
      loadDataUsage={async () => {
        throw new Error("transient usage failure");
      }}
    />,
  );

  const actions = captured.actions;
  if (!actions) {
    throw new Error("Expected usage refresh actions");
  }
  await actions.refresh();

  expect(actions.readUsage()).toBe(USAGE);
  expect(errors).toEqual([null, "transient usage failure"]);
});

test("an empty local pass leaves usage pending for the full request", async () => {
  // Entering Usage paints the local cache first and then reconciles. Settling on
  // an empty local pass would report "hasn't synced yet" while the real request
  // is still in flight.
  let settles = 0;
  const captured: { actions: RefreshProbeActions | null } = { actions: null };
  render(
    <RefreshProbe
      capture={(next) => {
        captured.actions = next;
      }}
      errors={[]}
      initialUsage={null}
      loadDataUsage={async () => null}
      onSettled={() => {
        settles += 1;
      }}
    />,
  );
  const actions = captured.actions;
  invariant(actions, "Expected the usage refresher probe to capture actions.");

  await act(async () => {
    await actions.refresh({ localOnly: true });
  });

  expect(settles).toBe(0);

  await act(async () => {
    await actions.refresh();
  });

  expect(settles).toBe(1);
});
