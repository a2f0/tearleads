import { describe, expect, test } from "bun:test";
import {
  isForeignSystemContainerNode,
  isSystemContainerNode,
} from "./reconcilableContainer";

describe("isSystemContainerNode", () => {
  test("is true for a container tagged with a system slot", () => {
    expect(
      isSystemContainerNode({ systemSlot: "sys_v1_organization_metadata" }),
    ).toBe(true);
  });

  test("is false for a user-facing container (no system slot)", () => {
    expect(isSystemContainerNode({ systemSlot: null })).toBe(false);
  });
});

describe("isForeignSystemContainerNode", () => {
  const foreignMetadata = {
    effectiveAccessLevel: "read" as const,
    organizationId: "org-founder",
    systemSlot: "sys_v1_meta",
  };

  test("is true for a read-granted foreign system container (a member's view)", () => {
    expect(isForeignSystemContainerNode(foreignMetadata, "org-home")).toBe(
      true,
    );
  });

  test("is true for an admin-granted foreign system container (an admin's view)", () => {
    expect(
      isForeignSystemContainerNode(
        { ...foreignMetadata, effectiveAccessLevel: "admin" },
        "org-home",
      ),
    ).toBe(true);
  });

  test("is false for the device's own system container", () => {
    expect(
      isForeignSystemContainerNode(
        { ...foreignMetadata, organizationId: "org-home" },
        "org-home",
      ),
    ).toBe(false);
  });

  test("is false for a foreign container merely write-shared (not a member)", () => {
    expect(
      isForeignSystemContainerNode(
        { ...foreignMetadata, effectiveAccessLevel: "write" },
        "org-home",
      ),
    ).toBe(false);
  });

  test("is false for a foreign user-facing (non-system) container", () => {
    expect(
      isForeignSystemContainerNode(
        { ...foreignMetadata, systemSlot: null },
        "org-home",
      ),
    ).toBe(false);
  });

  test("is false for a mid-creation system container with no organization id yet", () => {
    expect(
      isForeignSystemContainerNode(
        { ...foreignMetadata, organizationId: "" },
        "org-home",
      ),
    ).toBe(false);
  });

  test("matches nothing when the home org is unknown", () => {
    expect(isForeignSystemContainerNode(foreignMetadata, null)).toBe(false);
  });
});
