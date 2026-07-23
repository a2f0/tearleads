import { afterEach, expect, test } from "bun:test";
import type { OrganizationDataUsage } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
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
  readonly refresh: () => Promise<void>;
}

function RefreshProbe(input: {
  readonly capture: (actions: RefreshProbeActions) => void;
  readonly errors: Array<string | null>;
  readonly loadDataUsage: () => Promise<OrganizationDataUsage | null>;
}) {
  const beginRequest = useOrgManagerRequestGuard("org-a:user-a:db-a");
  const dataUsageRef = useRef<OrganizationDataUsage | null>(USAGE);
  const setDataUsage: Dispatch<SetStateAction<OrganizationDataUsage | null>> = (
    next,
  ) => {
    dataUsageRef.current =
      typeof next === "function" ? next(dataUsageRef.current) : next;
  };
  const refresh = useOrgManagerDataUsageRefresher({
    appData: {
      auth: { isAuthenticated: true, organizationId: "org-a" },
    } as ReturnType<typeof useTearleadsRuntime>,
    beginRequest,
    canLoadAuthenticatedOrgData: true,
    dataUsageRef,
    markDataUsageSettled: () => undefined,
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
