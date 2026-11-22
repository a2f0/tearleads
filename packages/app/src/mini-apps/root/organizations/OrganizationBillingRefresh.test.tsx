import "../../../../test/helpers/msw/server";
import { afterEach, expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { cleanupIdentityManagerTestEnvironment } from "../../../../test/helpers/identityManagerTestRuntime";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  renderRootWithSession,
  rootToolbar,
} from "../../../../test/helpers/renderRootConsole";
import { ROOT_TEST_ORGANIZATION } from "../../../../test/helpers/rootConsoleFixtures";

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("the Billing tab's Refresh reloads the organization and its deliveries, busy until both settle", async () => {
  const { restore, tearleads, view } = await renderRootWithSession(true);
  const detail = spyOn(tearleads.root, "loadOrganization");
  const deliveries = spyOn(tearleads.root, "listOrganizationRevenuecatEvents");
  type Deliveries = Awaited<ReturnType<typeof deliveries>>;
  try {
    fireEvent.click(view.getByRole("button", { name: "Organizations" }));
    fireEvent.click(
      await view.findByText(ROOT_TEST_ORGANIZATION.organization.organizationId),
    );
    fireEvent.click(view.getByRole("tab", { name: "Billing" }));
    await view.findByText(/RENEWAL · applied/);
    const refresh = rootToolbar(view).getByRole("button", { name: "Refresh" });
    await waitFor(() =>
      expect(refresh.getAttribute("aria-busy")).toBe("false"),
    );
    expect(detail).toHaveBeenCalledTimes(1);
    expect(deliveries).toHaveBeenCalledTimes(1);

    const held = Promise.withResolvers<Deliveries>();
    deliveries.mockImplementationOnce(() => held.promise);
    fireEvent.click(refresh);
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
    expect(deliveries).toHaveBeenCalledTimes(2);
    // The organization has reloaded; the deliveries beside it have not.
    await act(async () => {
      await detail.mock.results[1]?.value;
    });
    expect(refresh.getAttribute("aria-busy")).toBe("true");

    await act(async () =>
      held.resolve({ ok: true, data: { events: [], nextCursor: null } }),
    );
    await view.findByText("No RevenueCat deliveries.");
    expect(refresh.getAttribute("aria-busy")).toBe("false");
  } finally {
    detail.mockRestore();
    deliveries.mockRestore();
    restore();
  }
});
