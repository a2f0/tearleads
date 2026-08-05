import { expect, test } from "bun:test";
import {
  getOrgManagerBillingEventLabel,
  getOrgManagerBillingStatusLabel,
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  getOrgManagerPolicyAddedLabel,
  getOrgManagerPolicyChangeTypeLabel,
  getOrgManagerPolicyRemovedLabel,
  getOrgManagerPolicyRoleChangedLabel,
  getOrgManagerPolicyRoleLabel,
  getOrgManagerPolicyRoleTransitionLabel,
  getOrgManagerPolicySignatureLabel,
  getOrgManagerPolicyVersionLabel,
  getOrgManagerSeatsInUseLabel,
  getOrgManagerSeatsLabel,
  getOrgManagerTrialDaysLabel,
  ORG_MANAGER_LABELS,
} from "./labels";

test("org manager labels format variable display text", () => {
  expect(ORG_MANAGER_LABELS.directory).toBe("Roster");
  expect(ORG_MANAGER_LABELS.members).toBe("Members");
  expect(ORG_MANAGER_LABELS.policyHistory).toBe("Policy history");
  expect(ORG_MANAGER_LABELS.groupLinksTab).toBe("Links");
  expect(getOrgManagerMemberCountLabel(1)).toBe("1 member");
  expect(getOrgManagerMemberCountLabel(2)).toBe("2 members");
  expect(getOrgManagerSeatsLabel(1)).toBe("1 licensed seat");
  expect(getOrgManagerSeatsLabel(2)).toBe("2 licensed seats");
  expect(getOrgManagerSeatsInUseLabel(1, 5)).toBe("1 of 5 seats in use");
  expect(getOrgManagerEpochLabel(3)).toBe("Epoch 3");
  expect(getOrgManagerPolicyAddedLabel("Alice", "admin")).toBe(
    "Alice added as admin",
  );
  expect(getOrgManagerPolicyAddedLabel("Alice", null)).toBe("Alice added");
  expect(getOrgManagerPolicyRemovedLabel("Alice")).toBe("Alice removed");
  expect(getOrgManagerPolicyChangeTypeLabel("role_changed")).toBe(
    "Role changed",
  );
  expect(getOrgManagerPolicyRoleChangedLabel("Alice", "member", "admin")).toBe(
    "Alice changed from member to admin",
  );
  expect(getOrgManagerPolicyRoleLabel(null)).toBe("none");
  expect(getOrgManagerPolicyRoleLabel("member")).toBe("member");
  expect(getOrgManagerPolicyRoleTransitionLabel("member", "admin")).toBe(
    "member -> admin",
  );
  expect(getOrgManagerPolicySignatureLabel("May 20", "abc123")).toBe(
    "May 20 - signed by abc123",
  );
  expect(getOrgManagerPolicyVersionLabel(4)).toBe("Version 4");
});

test("billing status and trial labels format correctly", () => {
  expect(getOrgManagerBillingStatusLabel("local")).toBe("Local only");
  expect(getOrgManagerBillingStatusLabel("trialing")).toBe("Free trial");
  expect(getOrgManagerBillingStatusLabel("active")).toBe("Active subscription");
  expect(getOrgManagerBillingStatusLabel("past_due")).toBe("Payment past due");
  expect(getOrgManagerBillingStatusLabel("disabled")).toBe("Sync disabled");
  expect(getOrgManagerTrialDaysLabel(1)).toBe("1 day left");
  expect(getOrgManagerTrialDaysLabel(5)).toBe("5 days left");
  expect(ORG_MANAGER_LABELS.billingManageSubscription).toBe(
    "Manage subscription",
  );
  expect(ORG_MANAGER_LABELS.billingSubscriptionMoveMessage).toContain(
    "eligible for permanent deletion after 30 days",
  );
});

test("billing history labels cover invoice and licensed-seat events", () => {
  expect(getOrgManagerBillingEventLabel("INVOICE_PAID")).toBe("Invoice paid");
  expect(getOrgManagerBillingEventLabel("free_trial_initialized")).toBe(
    "Free trial initialized",
  );
  expect(getOrgManagerBillingEventLabel("free_trial_expired")).toBe(
    "Free trial expired",
  );
  expect(
    getOrgManagerBillingEventLabel("licensed_seat_count_initialized"),
  ).toBe("Licensed seats initialized");
  expect(getOrgManagerBillingEventLabel("licensed_seat_count_increased")).toBe(
    "Licensed seats increased",
  );
  expect(getOrgManagerBillingEventLabel("licensed_seat_count_reset")).toBe(
    "Licensed seats reset",
  );
  expect(getOrgManagerBillingEventLabel("TRANSFER_IN")).toBe(
    "Subscription moved here",
  );
  expect(getOrgManagerBillingEventLabel("TRANSFER_OUT")).toBe(
    "Subscription moved away",
  );
});
