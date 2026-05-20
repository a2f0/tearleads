import { expect, test } from "bun:test";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  getOrgManagerPolicyAddedLabel,
  getOrgManagerPolicyRemovedLabel,
  getOrgManagerPolicyRoleChangedLabel,
  getOrgManagerPolicyRoleLabel,
  getOrgManagerPolicySignatureLabel,
  getOrgManagerPolicyVersionLabel,
  ORG_MANAGER_LABELS,
} from "./labels";

test("org manager labels format variable display text", () => {
  expect(ORG_MANAGER_LABELS.directory).toBe("Directory");
  expect(ORG_MANAGER_LABELS.policyHistory).toBe("Policy history");
  expect(getOrgManagerMemberCountLabel(1)).toBe("1 member");
  expect(getOrgManagerMemberCountLabel(2)).toBe("2 members");
  expect(getOrgManagerEpochLabel(3)).toBe("Epoch 3");
  expect(getOrgManagerPolicyAddedLabel("Alice", "admin")).toBe(
    "Alice added as admin",
  );
  expect(getOrgManagerPolicyRemovedLabel("Alice")).toBe("Alice removed");
  expect(getOrgManagerPolicyRoleChangedLabel("Alice", "member", "admin")).toBe(
    "Alice changed from member to admin",
  );
  expect(getOrgManagerPolicyRoleLabel(null)).toBe("none");
  expect(getOrgManagerPolicyRoleLabel("member")).toBe("member");
  expect(getOrgManagerPolicySignatureLabel("May 20", "abc123")).toBe(
    "May 20 - signed by abc123",
  );
  expect(getOrgManagerPolicyVersionLabel(4)).toBe("Version 4");
});
