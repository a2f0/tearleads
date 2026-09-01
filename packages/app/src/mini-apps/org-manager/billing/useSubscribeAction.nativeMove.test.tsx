import { afterEach, expect, mock, test } from "bun:test";
import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  type SessionCreateOrganizationResult,
  type SyncPurchaseResult,
} from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { useNativeSubscriptionMove } from "../hooks/useNativeSubscriptionMove";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type BillingActionScope,
  type BillingActionState,
  emptyActionState,
  type UpdateActionState,
} from "./billingActionScope";

const SCOPE: BillingActionScope = {
  generation: 1,
  organizationId: "org-1",
  userId: "user-1",
};
const RESTORED_ORGANIZATION: SessionCreateOrganizationResult = {
  containerId: "restored-root",
  organizationId: "restored-org",
};

afterEach(cleanup);

type RestoreReceipt = () => Promise<SyncPurchaseResult>;

function purchases(
  restoreReceipt: RestoreReceipt,
  bindOrganization: PurchasesCapability["bindOrganization"] = () =>
    Promise.resolve(),
): PurchasesCapability {
  return {
    bindOrganization,
    identify: () => Promise.resolve(),
    isAvailable: true,
    async moveNativeSubscription(
      input: Parameters<PurchasesCapability["moveNativeSubscription"]>[0],
    ) {
      const restored = await restoreReceipt();
      if (!restored.syncEntitlementActive) {
        throw new Error("The restored receipt has no sync entitlement");
      }
      const organizationId = await input.prepareClaim();
      if (!organizationId) {
        throw new Error("The native subscription destination was not prepared");
      }
      if (!(await input.claim(organizationId, "play_store"))) {
        throw new Error("The server did not accept the native subscription");
      }
      await bindOrganization({ organizationId });
      return { organizationId };
    },
    nativeStore: "play_store",
  } as never;
}

function setup(input: {
  readonly activate?: (
    organization: SessionCreateOrganizationResult,
  ) => Promise<void>;
  readonly bindOrganization?: PurchasesCapability["bindOrganization"];
  readonly checkNativePurchaseEligibility?: () => Promise<
    | { readonly eligible: true; readonly reason: null }
    | {
        readonly eligible: false;
        readonly reason: "terminal_organization";
      }
  >;
  readonly claim: (organizationId: string, store: string) => Promise<boolean>;
  readonly complete?: (organizationId: string) => Promise<boolean>;
  readonly create?: () => Promise<SessionCreateOrganizationResult | null>;
  readonly restore: RestoreReceipt;
}) {
  let state: BillingActionState = emptyActionState(SCOPE);
  const updateActionState: UpdateActionState = (_scope, update) => {
    state = update(state);
  };
  const view = renderHook(
    ({ nativePurchaseAllowed }: { nativePurchaseAllowed: boolean }) =>
      useNativeSubscriptionMove({
        activateRestoredOrganization:
          input.activate ?? (() => Promise.resolve()),
        checkNativePurchaseEligibility:
          input.checkNativePurchaseEligibility ??
          (() => Promise.resolve({ eligible: true, reason: null })),
        claimNativeSubscription: input.claim,
        completeRestoreOrganization:
          input.complete ?? (() => Promise.resolve(true)),
        createRestoreOrganization:
          input.create ?? (() => Promise.resolve(RESTORED_ORGANIZATION)),
        currentScope: SCOPE,
        nativePurchaseAllowed,
        purchases: purchases(input.restore, input.bindOrganization),
        scopeRef: { current: SCOPE },
        updateActionState,
        userId: SCOPE.userId,
      }),
    {
      initialProps: { nativePurchaseAllowed: true },
      wrapper: ({ children }: PropsWithChildren) => (
        <LogProvider>{children}</LogProvider>
      ),
    },
  );
  return { state: () => state, view };
}

test("restore preflight blocks the provider for terminal server state", async () => {
  const restore = mock(() => Promise.resolve({ syncEntitlementActive: true }));
  const flow = setup({
    checkNativePurchaseEligibility: () =>
      Promise.resolve({
        eligible: false,
        reason: "terminal_organization",
      }),
    claim: () => Promise.resolve(true),
    restore,
  });

  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingEligibilityTerminal,
    ),
  );
  expect(restore).not.toHaveBeenCalled();
});

test("losing local eligibility closes and disables an open restore", () => {
  const restore = mock(() => Promise.resolve({ syncEntitlementActive: true }));
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore,
  });
  act(() => flow.view.result.current.request());
  expect(flow.view.result.current.open).toBe(true);

  flow.view.rerender({ nativePurchaseAllowed: false });
  expect(flow.view.result.current.open).toBe(false);
  act(() => flow.view.result.current.confirm());

  expect(restore).not.toHaveBeenCalled();
});

test("losing local eligibility clears a stalled restore before provider work", async () => {
  let finishPreflight:
    | ((result: { readonly eligible: true; readonly reason: null }) => void)
    | undefined;
  const restore = mock(() => Promise.resolve({ syncEntitlementActive: true }));
  const flow = setup({
    checkNativePurchaseEligibility: () =>
      new Promise((resolve) => {
        finishPreflight = resolve;
      }),
    claim: () => Promise.resolve(true),
    restore,
  });

  startMove(flow.view);
  await waitFor(() => expect(finishPreflight).toBeDefined());
  flow.view.rerender({ nativePurchaseAllowed: false });

  await waitFor(() => expect(flow.state().busy).toBeNull());
  expect(restore).not.toHaveBeenCalled();
  await act(async () => {
    finishPreflight?.({ eligible: true, reason: null });
    await Promise.resolve();
  });
  expect(restore).not.toHaveBeenCalled();
  expect(flow.state().actionError).toBeNull();
});

test("an invalidated restore cannot clear its replacement attempt", async () => {
  type Eligibility = { readonly eligible: true; readonly reason: null };
  const finishPreflights: Array<(result: Eligibility) => void> = [];
  const restore = mock(() => Promise.resolve({ syncEntitlementActive: true }));
  const flow = setup({
    checkNativePurchaseEligibility: () =>
      new Promise<Eligibility>((resolve) => {
        finishPreflights.push(resolve);
      }),
    claim: () => Promise.resolve(true),
    restore,
  });

  startMove(flow.view);
  await waitFor(() => expect(finishPreflights).toHaveLength(1));
  flow.view.rerender({ nativePurchaseAllowed: false });
  await waitFor(() => expect(flow.state().busy).toBeNull());

  flow.view.rerender({ nativePurchaseAllowed: true });
  startMove(flow.view);
  await waitFor(() => expect(finishPreflights).toHaveLength(2));
  expect(flow.state().busy).toBe("restore");

  await act(async () => {
    finishPreflights[0]?.({ eligible: true, reason: null });
    await Promise.resolve();
  });
  expect(restore).not.toHaveBeenCalled();
  expect(flow.state().busy).toBe("restore");

  finishPreflights[1]?.({ eligible: true, reason: null });
  await waitFor(() => expect(flow.state().busy).toBeNull());
  expect(restore).toHaveBeenCalledTimes(1);
});

function startMove(view: ReturnType<typeof setup>["view"]): void {
  act(() => view.result.current.request());
  act(() => view.result.current.confirm());
}

test("restore stays busy and rejects a receipt without sync", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () => Promise.resolve({ syncEntitlementActive: false }),
  });
  startMove(flow.view);
  expect(flow.state().busy).toBe("restore");
  expect(flow.view.result.current.open).toBe(true);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.failedRestorePurchases,
    ),
  );
  expect(flow.view.result.current.open).toBe(false);
});

test("restore asks the buyer to retry while identity is settling", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () => Promise.reject(new PurchaseIdentityPendingError()),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingIdentityPending,
    ),
  );
});

test("restore reports a server claim timeout separately from identity", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () =>
      Promise.reject(
        Object.assign(new Error("claim timed out"), {
          code: "native-claim-timeout",
        }),
      ),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.nativeClaimTimedOut,
    ),
  );
});

test("restore asks for restart when the provider bridge stalls", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () => Promise.reject(new PurchaseProviderStalledError()),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingProviderStalled,
    ),
  );
});

test("restore surfaces a server-side claim rejection", async () => {
  const claim = mock(() => Promise.resolve(false));
  const bindOrganization = mock(() => Promise.resolve());
  const flow = setup({
    bindOrganization,
    claim,
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.failedRestorePurchases,
    ),
  );
  expect(claim).toHaveBeenCalledWith("restored-org", "play_store");
  expect(bindOrganization).not.toHaveBeenCalled();
});

test("restore binds lifecycle attribution only after the claim succeeds", async () => {
  const calls: string[] = [];
  const flow = setup({
    bindOrganization: () => {
      calls.push("bind");
      return Promise.resolve();
    },
    claim: () => {
      calls.push("claim");
      return Promise.resolve(true);
    },
    restore: () => {
      calls.push("restore");
      return Promise.resolve({ syncEntitlementActive: true });
    },
  });
  startMove(flow.view);

  await waitFor(() => expect(flow.state().busy).toBeNull());
  expect(calls).toEqual(["restore", "claim", "bind"]);
});

test("restore verifies the receipt before creating its fresh organization", async () => {
  const create = mock(() => Promise.resolve(RESTORED_ORGANIZATION));
  const flow = setup({
    claim: () => Promise.resolve(true),
    create,
    restore: () => Promise.resolve({ syncEntitlementActive: false }),
  });

  startMove(flow.view);
  await waitFor(() => expect(flow.state().busy).toBeNull());

  expect(create).not.toHaveBeenCalled();
});

test("restore activates the new organization after claim and binding", async () => {
  const activate = mock(() => Promise.resolve());
  const flow = setup({
    activate,
    claim: () => Promise.resolve(true),
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });

  startMove(flow.view);
  await waitFor(() => expect(flow.state().busy).toBeNull());

  expect(activate).toHaveBeenCalledWith(RESTORED_ORGANIZATION);
});

test("restore completion waits for durable organization activation", async () => {
  let finishActivation: (() => void) | undefined;
  const activate = mock(
    () =>
      new Promise<void>((resolve) => {
        finishActivation = resolve;
      }),
  );
  const complete = mock(() => Promise.resolve(true));
  const flow = setup({
    activate,
    claim: () => Promise.resolve(true),
    complete,
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });

  startMove(flow.view);
  await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
  expect(complete).not.toHaveBeenCalled();
  finishActivation?.();
  await waitFor(() => expect(flow.state().busy).toBeNull());
  expect(complete).toHaveBeenCalledWith(RESTORED_ORGANIZATION.organizationId);
});

test("failed durable activation retains the restore completion marker", async () => {
  const complete = mock(() => Promise.resolve(true));
  const flow = setup({
    activate: () => Promise.reject(new Error("session persistence failed")),
    claim: () => Promise.resolve(true),
    complete,
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });

  startMove(flow.view);
  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.failedRestorePurchases,
    ),
  );
  expect(complete).not.toHaveBeenCalled();
});

test("a binding failure can retry the idempotent native move", async () => {
  const claim = mock(() => Promise.resolve(true));
  const create = mock(() => Promise.resolve(RESTORED_ORGANIZATION));
  const restore = mock(() => Promise.resolve({ syncEntitlementActive: true }));
  let bindAttempts = 0;
  const bindOrganization = mock(() => {
    bindAttempts += 1;
    return bindAttempts === 1
      ? Promise.reject(new PurchaseProviderStalledError())
      : Promise.resolve();
  });
  const flow = setup({ bindOrganization, claim, create, restore });
  startMove(flow.view);
  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingProviderStalled,
    ),
  );

  startMove(flow.view);
  await waitFor(() => expect(flow.state().busy).toBeNull());

  expect(restore).toHaveBeenCalledTimes(2);
  // Each UI attempt asks the durable session workflow for a destination; it
  // replays the same organization until completion instead of relying on hook
  // memory that disappears on reload.
  expect(create).toHaveBeenCalledTimes(2);
  expect(claim).toHaveBeenCalledTimes(2);
  expect(bindOrganization).toHaveBeenCalledTimes(2);
  expect(flow.state().actionError).toBeNull();
});

test.each([
  [404, ORG_MANAGER_LABELS.nativeClaimNotFound],
  [409, ORG_MANAGER_LABELS.nativeClaimConflict],
  [503, ORG_MANAGER_LABELS.nativeClaimPending],
] as const)("restore surfaces an actionable %s claim failure", async (status, label) => {
  const flow = setup({
    claim: () =>
      Promise.reject(Object.assign(new Error("claim rejected"), { status })),
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });
  startMove(flow.view);

  await waitFor(() => expect(flow.state().actionError).toBe(label));
});
