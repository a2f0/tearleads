import { expect, test } from "bun:test";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  ORG_MANAGER_LABELS,
} from "./labels";

test("org manager labels format variable display text", () => {
  expect(ORG_MANAGER_LABELS.directory).toBe("Directory");
  expect(ORG_MANAGER_LABELS.policyHistory).toBe("Policy history");
  expect(getOrgManagerMemberCountLabel(1)).toBe("1 member");
  expect(getOrgManagerMemberCountLabel(2)).toBe("2 members");
  expect(getOrgManagerEpochLabel(3)).toBe("Epoch 3");
});
