import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  OPTION,
  restoreBillingPanelSpies,
  stubEnvironment,
  wrapper,
} from "../../test/helpers/billingPanelTestKit";
import { BillingPanel } from "../mini-apps/org-manager/billing/BillingPanel";
import { ORG_MANAGER_LABELS } from "../mini-apps/org-manager/labels";

afterEach(() => {
  cleanup();
  restoreBillingPanelSpies();
});

test.each([
  ["pending", () => new Promise<never>(() => undefined)],
  ["failed", () => Promise.reject(new Error("500"))],
])(
  "a lapsed Stripe subscription hides the checkout while management is %s",
  async (_state, loadBillingManagementUrl) => {
    // The renewal webhook is late: the read path projects the lapse as
    // `disabled`, but the snapshot still names Stripe as the owner. The
    // checkout gate comes from the snapshot, so a management lookup that never
    // answers, or fails, cannot open a second checkout against the renewal.
    const loadStripeCheckoutOptions = mock(() =>
      Promise.resolve({ options: [OPTION] }),
    );
    stubEnvironment(false, {
      loadBillingManagementUrl,
      loadStripeCheckoutOptions,
      status: "disabled",
      subscriptionSource: "stripe",
    });

    const view = render(
      <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
      { wrapper },
    );

    await waitFor(() =>
      expect(view.getByText(ORG_MANAGER_LABELS.billingDisabled)).toBeDefined(),
    );
    expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
    expect(loadStripeCheckoutOptions).not.toHaveBeenCalled();
  },
);
