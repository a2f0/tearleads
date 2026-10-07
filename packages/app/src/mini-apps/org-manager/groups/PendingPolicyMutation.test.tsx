import { afterEach, expect, mock, test } from "bun:test";
import {
  type AuthoredPrincipalMutation,
  buildInitialGroupPolicyRequest,
  createDomainScope,
  type Organizations,
  PrincipalMutationOutcomeUnknownError,
  UnreadablePrincipalMutationError,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import {
  createOrgManagerContextValue,
  OrgManagerContext,
} from "../../../stores/org-manager/OrgManagerProvider";
import { PendingPolicyMutation } from "./PendingPolicyMutation";

afterEach(cleanup);

async function fixture() {
  const signing = generateSigningSeedAndKeyPair();
  const group = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
    groupId: crypto.randomUUID(),
    builtinRole: "admins",
    name: "Admins",
    signerUserId: crypto.randomUUID(),
    signingFingerprint: await toFingerprint(signing.signingPublicKey),
    signingKeyPair: signing,
  });
  // The provider supplies already-authenticated authored work. This fixture tests
  // presentation and exact object forwarding; SDK/HTTP tests verify signatures.
  const mutation: AuthoredPrincipalMutation = {
    groupId: group.groupId,
    request: {
      groupPolicy: group.initialGroupPolicy,
      organizationPolicy: {
        ...group.initialGroupPolicy,
        state: {
          ...group.initialGroupPolicy.state,
          principalType: "organization",
          principalId: "org-a",
        },
      },
    },
  };
  let pending: AuthoredPrincipalMutation | null = mutation;
  let active = true;
  const scope = {
    organizationId: "org-a",
    userId: "actor",
    signingFingerprint: "key",
    containerId: "root",
    domainScope: createDomainScope(),
    generation: {},
  };
  const read = mock(async () => pending);
  const retry = mock(async () => {
    pending = null;
  });
  const abandon = mock(async () => {
    pending = null;
    return true;
  });
  const discard = mock(async () => {
    pending = null;
    return true;
  });
  const unused = async () => null;
  const organizations = new Proxy(
    {
      readPendingPolicyMutation: read,
      retryPendingPolicyMutation: retry,
      abandonPendingPolicyMutation: abandon,
      discardUnreadablePolicyMutation: discard,
    },
    {
      get(target, key) {
        return Reflect.get(target, key) ?? unused;
      },
    },
  ) as unknown as Organizations;
  const value = createOrgManagerContextValue(organizations, {
    captureOperationScope: () => scope,
    isOperationScopeActive: () => active,
    ensureOrganizationMetadataContainer: unused,
    ensureOrganizationProfileDocument: unused,
    ensureRosterProfileContainer: unused,
    ensureRosterProfileDocument: unused,
  });
  const resolved = mock(async () => {});
  const ui = (
    organizationId = "org-a",
    refreshSignal: string | null = null,
  ) => (
    <OrgManagerContext.Provider value={value}>
      <PendingPolicyMutation
        organizationId={organizationId}
        groups={[]}
        refreshSignal={refreshSignal}
        mutating={false}
        onResolved={resolved}
      />
    </OrgManagerContext.Provider>
  );
  return {
    abandon,
    discard,
    mutation,
    read,
    resolved,
    retry,
    ui,
    expire() {
      active = false;
    },
    renew() {
      active = true;
    },
    get pending() {
      return pending;
    },
  };
}

test("Org Manager exposes a saved change and retries it without abandoning it", async () => {
  const f = await fixture();
  const view = render(f.ui());
  const button = await view.findByRole("button", {
    name: "Retry saved change",
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(
      view.queryByRole("region", { name: "Saved access change" }),
    ).toBeNull(),
  );
  expect(f.retry).toHaveBeenCalledWith("org-a");
  expect(f.abandon).not.toHaveBeenCalled();
  expect(f.resolved).toHaveBeenCalledTimes(1);
});

test("an unreadable saved request offers an explicit discard action", async () => {
  const f = await fixture();
  f.read.mockImplementation(async () => {
    throw new UnreadablePrincipalMutationError(
      "inspected-record",
      "authentication",
    );
  });
  const view = render(f.ui());
  await view.findByText("Saved principal mutation could not be authenticated");
  expect(view.queryByRole("button", { name: "Stop retrying…" })).not.toBeNull();
  expect(view.queryByRole("button", { name: "Retry saved change" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Stop retrying…" }));
  expect(f.discard).not.toHaveBeenCalled();
  expect(view.getByText(/will not undo a change/)).toBeDefined();
  f.read.mockImplementation(async () => null);
  fireEvent.click(
    view.getByRole("button", { name: "Stop retrying this change" }),
  );
  await waitFor(() => expect(f.resolved).toHaveBeenCalledTimes(1));
  expect(f.discard).toHaveBeenCalledWith({
    organizationId: "org-a",
    recordId: "inspected-record",
    acknowledgeUnknownOutcome: true,
  });
  expect(f.retry).not.toHaveBeenCalled();
  expect(f.abandon).not.toHaveBeenCalled();
});

test.each(["readable", "unreadable"] as const)(
  "a failed refresh removes stale %s journal actions until inspection succeeds",
  async (kind) => {
    const f = await fixture();
    if (kind === "unreadable")
      f.read.mockImplementation(async () => {
        throw new UnreadablePrincipalMutationError(
          "old-record",
          "authentication",
        );
      });
    const view = render(f.ui());
    await view.findByRole("button", { name: "Stop retrying…" });
    f.read.mockImplementation(async () => {
      throw new Error("Storage temporarily unavailable");
    });
    view.rerender(f.ui("org-a", "failed refresh"));
    await view.findByText("Storage temporarily unavailable");
    expect(
      view.queryByRole("button", { name: "Retry saved change" }),
    ).toBeNull();
    expect(view.queryByRole("button", { name: "Stop retrying…" })).toBeNull();
    expect(f.retry).not.toHaveBeenCalled();
    expect(f.abandon).not.toHaveBeenCalled();
    expect(f.discard).not.toHaveBeenCalled();
    f.read.mockImplementation(async () => f.mutation);
    view.rerender(f.ui("org-a", "successful refresh"));
    await view.findByRole("button", { name: "Retry saved change" });
  },
);

test("a settled retry releases its busy state after the captured scope expires", async () => {
  const f = await fixture();
  const delayed = Promise.withResolvers<void>();
  f.retry.mockImplementation(() => delayed.promise);
  const view = render(f.ui());
  fireEvent.click(
    await view.findByRole("button", { name: "Retry saved change" }),
  );
  f.expire();
  await act(async () => {
    delayed.resolve();
    await delayed.promise;
  });
  f.renew();
  view.rerender(f.ui());
  expect(
    view.queryByRole("button", { name: "Retry saved change" }),
  ).not.toBeNull();
  expect(f.resolved).not.toHaveBeenCalled();
});

test("a refused recovery stays visible until the user explicitly stops retries", async () => {
  const f = await fixture();
  f.retry.mockImplementation(async () => {
    throw new PrincipalMutationOutcomeUnknownError();
  });
  const view = render(f.ui());
  fireEvent.click(
    await view.findByRole("button", { name: "Retry saved change" }),
  );
  await view.findByText(/may have committed/);
  expect(f.pending).toBe(f.mutation);
  fireEvent.click(view.getByRole("button", { name: "Stop retrying…" }));
  expect(f.abandon).not.toHaveBeenCalled();
  expect(view.getByText(/will not undo a change/)).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Keep saved request" }));
  expect(f.pending).toBe(f.mutation);
  fireEvent.click(view.getByRole("button", { name: "Stop retrying…" }));
  fireEvent.click(
    view.getByRole("button", { name: "Stop retrying this change" }),
  );
  await waitFor(() => expect(f.resolved).toHaveBeenCalledTimes(1));
  expect(f.abandon).toHaveBeenCalledWith({
    organizationId: "org-a",
    mutation: f.mutation,
    acknowledgeUnknownOutcome: true,
  });
  expect(f.pending).toBeNull();
});

test("a delayed inspection cannot publish another organization's saved request", async () => {
  const f = await fixture();
  const delayed = Promise.withResolvers<AuthoredPrincipalMutation | null>();
  f.read.mockImplementation(() => delayed.promise);
  const view = render(f.ui());
  await waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
  f.expire();
  view.rerender(f.ui("org-b"));
  await act(async () => {
    delayed.resolve(f.mutation);
    await delayed.promise;
  });
  expect(
    view.queryByRole("region", { name: "Saved access change" }),
  ).toBeNull();
  expect(f.retry).not.toHaveBeenCalled();
  expect(f.abandon).not.toHaveBeenCalled();
});
