import { describe, expect, test } from "bun:test";
import {
  isAutomaticRootCatchupContainerNode,
  isForeignSystemContainerNode,
  isReconcilableContainerNode,
  isRemoteBackedContainerNode,
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

describe("isAutomaticRootCatchupContainerNode", () => {
  test("excludes own system containers from automatic root catch-up", () => {
    expect(
      isAutomaticRootCatchupContainerNode(
        {
          effectiveAccessLevel: "admin",
          metadataDocumentId: "contacts-metadata",
          organizationId: "org-home",
          systemSlot: "sys_v1_contacts",
        },
        "org-home",
      ),
    ).toBe(false);
  });

  test("retains regular direct shares and membership-visible foreign systems", () => {
    expect(
      isAutomaticRootCatchupContainerNode(
        {
          effectiveAccessLevel: "read",
          metadataDocumentId: "regular-metadata",
          organizationId: "org-foreign",
          systemSlot: null,
        },
        "org-home",
      ),
    ).toBe(true);
    expect(
      isAutomaticRootCatchupContainerNode(
        {
          effectiveAccessLevel: "read",
          metadataDocumentId: "foreign-metadata",
          organizationId: "org-foreign",
          systemSlot: "sys_v1_metadata",
        },
        "org-home",
      ),
    ).toBe(true);
  });

  test("excludes a local-first regular container", () => {
    expect(
      isAutomaticRootCatchupContainerNode(
        {
          effectiveAccessLevel: "admin",
          metadataDocumentId: null,
          organizationId: "",
          systemSlot: null,
        },
        "org-home",
      ),
    ).toBe(false);
  });
});

describe("remote-backed reconciliation", () => {
  test("recognizes a container with remote metadata", () => {
    expect(
      isRemoteBackedContainerNode({
        metadataDocumentId: "metadata-document-1",
      }),
    ).toBe(true);
    expect(isRemoteBackedContainerNode({ metadataDocumentId: null })).toBe(
      false,
    );
  });

  test("includes remote-backed system containers but not local-only slots", () => {
    expect(
      isReconcilableContainerNode(
        {
          effectiveAccessLevel: "admin",
          metadataDocumentId: "contacts-metadata-document",
          organizationId: "org-home",
          systemSlot: "sys_v1_contacts",
        },
        "org-home",
      ),
    ).toBe(true);
    expect(
      isReconcilableContainerNode(
        {
          effectiveAccessLevel: "admin",
          metadataDocumentId: null,
          organizationId: "org-home",
          systemSlot: "sys_v1_contacts",
        },
        "org-home",
      ),
    ).toBe(false);
  });

  test("includes membership-visible foreign systems but excludes write shares", () => {
    const foreignSystem = {
      metadataDocumentId: "foreign-metadata-document",
      organizationId: "org-foreign",
      systemSlot: "sys_v1_foreign",
    };
    expect(
      isReconcilableContainerNode(
        { ...foreignSystem, effectiveAccessLevel: "read" },
        "org-home",
      ),
    ).toBe(true);
    expect(
      isReconcilableContainerNode(
        { ...foreignSystem, effectiveAccessLevel: "write" },
        "org-home",
      ),
    ).toBe(false);
  });

  test("includes remote-backed user containers but not local-first ids", () => {
    expect(
      isReconcilableContainerNode(
        {
          effectiveAccessLevel: "admin",
          metadataDocumentId: null,
          organizationId: "",
          systemSlot: null,
        },
        null,
      ),
    ).toBe(false);
    expect(
      isReconcilableContainerNode(
        {
          effectiveAccessLevel: "admin",
          metadataDocumentId: "remote-metadata",
          organizationId: "org-home",
          systemSlot: null,
        },
        "org-home",
      ),
    ).toBe(true);
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
