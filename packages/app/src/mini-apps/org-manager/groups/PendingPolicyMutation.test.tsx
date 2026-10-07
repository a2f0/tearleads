import { afterEach, expect, mock, test } from "bun:test";
import {
  type AuthoredPrincipalMutation,
  buildInitialGroupPolicyRequest,
  createDomainScope,
  type Organizations,
  PrincipalMutationOutcomeUnknownError,
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
  const unused = async () => null;
  const organizations = new Proxy(
    {
      readPendingPolicyMutation: read,
      retryPendingPolicyMutation: retry,
      abandonPendingPolicyMutation: abandon,
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
  const ui = (organizationId = "org-a") => (
    <OrgManagerContext.Provider value={value}>
      <PendingPolicyMutation
        organizationId={organizationId}
        groups={[]}
        refreshSignal={null}
        mutating={false}
        onResolved={resolved}
      />
    </OrgManagerContext.Provider>
  );
  return {
    abandon,
    mutation,
    read,
    resolved,
    retry,
    ui,
    expire() {
      active = false;
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
