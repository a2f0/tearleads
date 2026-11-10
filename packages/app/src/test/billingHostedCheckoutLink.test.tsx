import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import {
  capabilityWith,
  createCapturingDiagnostics,
  OPTION,
  renderFlow,
  restoreDirectCheckoutSpies,
  stubTearleads,
} from "../../test/helpers/directCheckoutTestKit";
import { CHECKOUT_LABELS } from "../mini-apps/org-manager/billing/checkoutCopy";

/**
 * "Pay on Stripe instead": Stripe's hosted page for the plan the open form
 * shows, run by the checkout's own state so only one way to pay runs at once.
 */

const restores: (() => void)[] = [];

afterEach(() => {
  restoreDirectCheckoutSpies();
  for (const restore of restores.splice(0)) {
    restore();
  }
});

function fakeTab() {
  return {
    opener: {} as unknown,
    location: { href: "" },
    close: mock(() => undefined),
  };
}

/**
 * Stubs `globalThis.open` through a configurable property rather than `spyOn`,
 * which tears down the happy-dom window binding and strips `document` /
 * `location` from every later test.
 */
function stubOpen(impl: () => unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "open");
  Object.defineProperty(globalThis, "open", {
    configurable: true,
    writable: true,
    value: impl,
  });
  restores.push(() => {
    if (previous) {
      Object.defineProperty(globalThis, "open", previous);
    } else {
      Reflect.deleteProperty(globalThis, "open");
    }
  });
}

function stubAssign() {
  const assign = spyOn(globalThis.location, "assign").mockImplementation(
    () => undefined,
  );
  restores.push(() => assign.mockRestore());
  return assign;
}

/** A flow with the default plan's form open and ready. */
async function openForm(
  createStripeCheckoutSession: (
    priceId: string,
    returnUrl: string,
    organizationId?: string,
  ) => Promise<unknown>,
) {
  const organizations = stubTearleads({ createStripeCheckoutSession });
  const unmount = mock(() => undefined);
  const { capability, mounted } = capabilityWith({ unmount });
  const { captured, diagnostics } = createCapturingDiagnostics();
  const flow = renderFlow(capability, undefined, "org-1", diagnostics);
  await waitFor(() => expect(flow.result.current.options).toEqual([OPTION]));
  await act(async () => flow.result.current.begin(OPTION));
  await waitFor(() =>
    expect(flow.result.current.phase.kind).toBe("collecting"),
  );
  return { ...flow, captured, mounted, organizations, unmount };
}

test("Stripe's page opens for the form's plan in a new tab, and the form closes", async () => {
  const tab = fakeTab();
  const openTab = mock(() => tab);
  stubOpen(openTab);
  const { organizations, result, unmount } = await openForm(() =>
    Promise.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );

  await act(async () => result.current.openStripePage());

  // Opened synchronously on the click (before the await), so pop-up blockers
  // allow it, then pointed at the minted URL.
  expect(openTab).toHaveBeenCalledWith("about:blank", "_blank");
  const [priceId, , organizationId] =
    organizations.createStripeCheckoutSession.mock.calls[0] ?? [];
  expect(priceId).toBe(OPTION.priceId);
  expect(organizationId).toBe("org-1");
  await waitFor(() =>
    expect(tab.location.href).toBe("https://checkout.stripe.com/pay/x"),
  );
  // The child's back-reference is severed to prevent reverse tabnabbing.
  expect(tab.opener).toBeNull();
  expect(result.current.phase.kind).toBe("idle");
  expect(unmount).toHaveBeenCalledTimes(1);
});

test("a blocked pop-up falls back to same-tab navigation", async () => {
  stubOpen(() => null);
  const assign = stubAssign();
  const { result } = await openForm(() =>
    Promise.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );

  await act(async () => result.current.openStripePage());

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay/x"),
  );
});

test("while Stripe's page opens, neither Pay nor the plan can change", async () => {
  stubOpen(() => fakeTab());
  const minted = Promise.withResolvers<{ url: string | null }>();
  const { organizations, result } = await openForm(() => minted.promise);
  const team = { ...OPTION, priceId: "price_team_5", unitAmount: 1000 };

  act(() => {
    result.current.openStripePage();
    result.current.openStripePage();
  });
  expect(result.current.phase.kind).toBe("opening-stripe");
  act(() => {
    result.current.confirm();
    result.current.changePlan(team);
  });

  expect(result.current.phase.kind).toBe("opening-stripe");
  expect(organizations.createStripeCheckoutSession).toHaveBeenCalledTimes(1);
  expect(organizations.createStripeCheckout).not.toHaveBeenCalled();
  await act(async () => minted.resolve({ url: null }));
});

test("an unavailable page returns to the form with a notice", async () => {
  const tab = fakeTab();
  stubOpen(() => tab);
  const { captured, result } = await openForm(() =>
    Promise.resolve({ url: null }),
  );

  await act(async () => result.current.openStripePage());

  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(result.current.error).toBe(CHECKOUT_LABELS.payOnStripeUnavailable);
  expect(tab.close).toHaveBeenCalledTimes(1);
  expect(captured).toEqual([]);
});

test("a refused page returns to the form, and the failure is reported", async () => {
  const tab = fakeTab();
  stubOpen(() => tab);
  const failure = new Error("boom");
  const { captured, result } = await openForm(() => Promise.reject(failure));

  await act(async () => result.current.openStripePage());

  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(result.current.error).toBe(CHECKOUT_LABELS.payOnStripeUnavailable);
  expect(tab.close).toHaveBeenCalledTimes(1);
  expect(captured).toEqual([failure]);
});

test("a plan no longer offered closes the form quietly and reloads the plans", async () => {
  const tab = fakeTab();
  stubOpen(() => tab);
  const { captured, organizations, result } = await openForm(() =>
    Promise.reject(
      Object.assign(new Error("plan unavailable"), {
        code: "billing_checkout_plan_unavailable",
      }),
    ),
  );

  await act(async () => result.current.openStripePage());

  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(result.current.error).toBe(CHECKOUT_LABELS.planUnavailable);
  expect(tab.close).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(organizations.loadStripeCheckoutOptions).toHaveBeenCalledTimes(2),
  );
  expect(captured).toEqual([]);
});

test("a late answer for a cancelled form neither navigates nor closes its replacement", async () => {
  stubOpen(() => null);
  const assign = stubAssign();
  const minted = Promise.withResolvers<{ url: string | null }>();
  const { mounted, result } = await openForm(() => minted.promise);

  act(() => result.current.openStripePage());
  act(() => result.current.cancel());
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(mounted).toHaveLength(2));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () =>
    minted.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );

  expect(assign).not.toHaveBeenCalled();
  expect(result.current.phase.kind).toBe("collecting");
});
