import { afterEach, expect, mock, test } from "bun:test";
import {
  useWindowRefreshMenuItem,
  useWindowRefreshMenuItemValue,
  WindowMenuProvider,
} from "@tearleads/windowing";
import {
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import {
  restoreBillingPanelSpies,
  stubEnvironment,
  wrapper,
} from "../../test/helpers/billingPanelTestKit";
import { BillingPanel } from "../mini-apps/org-manager/billing/BillingPanel";
import { CHECKOUT_LABELS } from "../mini-apps/org-manager/billing/checkoutCopy";
import { ORG_MANAGER_LABELS } from "../mini-apps/org-manager/labels";

afterEach(() => {
  cleanup();
  restoreBillingPanelSpies();
});

// Org Manager registers its roster-wide refresh at the default priority while
// any of its views is open.
function RosterRefresh({ onRefresh }: { onRefresh: () => void }) {
  useWindowRefreshMenuItem({ onRefresh });
  return null;
}

// Both window hosts draw the registered refresh as the toolbar's one button.
function ToolbarRefresh() {
  const refresh = useWindowRefreshMenuItemValue();
  return refresh ? (
    <button
      aria-label={refresh.label}
      data-testid="toolbar-refresh"
      disabled={refresh.disabled}
      type="button"
      onClick={refresh.onClick}
    />
  ) : null;
}

function orgManagerWindow(input: {
  billingOpen: boolean;
  isOrgAdmin?: boolean;
  rosterRefresh: () => void;
}) {
  return (
    <WindowMenuProvider>
      <RosterRefresh onRefresh={input.rosterRefresh} />
      {input.billingOpen ? (
        <BillingPanel
          isOrgAdmin={input.isOrgAdmin ?? true}
          organizationId="org-1"
          userId="user-1"
        />
      ) : null}
      <ToolbarRefresh />
    </WindowMenuProvider>
  );
}

function toolbarRefresh(view: RenderResult): HTMLButtonElement {
  return view.getByTestId("toolbar-refresh") as HTMLButtonElement;
}

test("the toolbar Refresh re-reads billing while Billing is open", async () => {
  const billingRefresh = mock(() => Promise.resolve());
  const rosterRefresh = mock(() => undefined);
  stubEnvironment(false, { refresh: billingRefresh });
  const view = render(orgManagerWindow({ billingOpen: true, rosterRefresh }), {
    wrapper,
  });

  await waitFor(() => expect(toolbarRefresh(view).disabled).toBe(false));
  fireEvent.click(toolbarRefresh(view));

  expect(billingRefresh).toHaveBeenCalledTimes(1);
  expect(rosterRefresh).not.toHaveBeenCalled();

  // Leaving Billing hands the window's Refresh back to the roster.
  view.rerender(orgManagerWindow({ billingOpen: false, rosterRefresh }));
  fireEvent.click(toolbarRefresh(view));

  expect(rosterRefresh).toHaveBeenCalledTimes(1);
  expect(billingRefresh).toHaveBeenCalledTimes(1);
});

test("the toolbar Refresh stays with Billing but waits while billing loads", async () => {
  const rosterRefresh = mock(() => undefined);
  stubEnvironment(false, { loading: true });
  const view = render(orgManagerWindow({ billingOpen: true, rosterRefresh }), {
    wrapper,
  });

  await view.findByText(ORG_MANAGER_LABELS.billingTitle);
  const button = toolbarRefresh(view);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(rosterRefresh).not.toHaveBeenCalled();
});

test("the toolbar Refresh waits while a checkout is in flight", async () => {
  stubEnvironment(false);
  const view = render(
    orgManagerWindow({ billingOpen: true, rosterRefresh: () => undefined }),
    { wrapper },
  );
  await waitFor(() => expect(toolbarRefresh(view).disabled).toBe(false));

  // The wrapper's checkout never finishes mounting, so it stays in flight on
  // its loading panel.
  fireEvent.click(
    await view.findByRole("button", {
      name: ORG_MANAGER_LABELS.billingSubscribe,
    }),
  );
  await view.findByRole("button", {
    name: CHECKOUT_LABELS.cancel,
  });

  expect(toolbarRefresh(view).disabled).toBe(true);
});

test("losing admin rights mid history load releases the toolbar Refresh", async () => {
  // The admin-only history read never settles, so its first load stays open.
  stubEnvironment(false, { loadBillingHistory: () => new Promise(() => {}) });
  const rosterRefresh = () => undefined;
  const view = render(orgManagerWindow({ billingOpen: true, rosterRefresh }), {
    wrapper,
  });
  await view.findByText(ORG_MANAGER_LABELS.billingTitle);
  expect(toolbarRefresh(view).disabled).toBe(true);

  view.rerender(
    orgManagerWindow({ billingOpen: true, isOrgAdmin: false, rosterRefresh }),
  );

  await waitFor(() => expect(toolbarRefresh(view).disabled).toBe(false));
});
