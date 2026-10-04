import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  cachedDestinationRole,
  rememberDestinationRole,
} from "./destinationRoleCache";

test("metadata binding cache keeps organization and container identities distinct", () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const identity = { organizationId: "organization:a", id: "b" };
    const role = {
      metadataDocumentId: "authenticated-metadata",
      systemSlot: null,
      createSignerUserId: "owner",
      rootContainerId: "fixture-root",
      rootCreateManifestHash: "fixture-root-genesis",
      rootMetadataDocumentId: "fixture-root-metadata",
    };
    rememberDestinationRole(execSql, identity, role);
    expect(cachedDestinationRole(execSql, identity)).toEqual(role);
    expect(
      cachedDestinationRole(execSql, {
        organizationId: "organization",
        id: "a:b",
      }),
    ).toBeUndefined();
  } finally {
    close();
  }
});

test("ordinary binding eviction preserves root and system reconciliation roles", () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const root = { organizationId: "organization", id: "root" };
    const system = { ...root, id: "system" };
    const ordinaryRole = {
      metadataDocumentId: "metadata",
      systemSlot: null,
      createSignerUserId: "owner",
      rootContainerId: "fixture-root",
      rootCreateManifestHash: "fixture-root-genesis",
      rootMetadataDocumentId: "fixture-root-metadata",
    };
    const rootRole = { ...ordinaryRole, parentId: null };
    const systemRole = {
      ...ordinaryRole,
      parentId: root.id,
      systemSlot: "contacts",
    };
    rememberDestinationRole(execSql, root, rootRole);
    rememberDestinationRole(execSql, system, systemRole);
    for (let index = 0; index <= 1_000; index += 1) {
      rememberDestinationRole(
        execSql,
        { ...root, id: `ordinary-${index}` },
        ordinaryRole,
      );
    }
    expect(cachedDestinationRole(execSql, root)).toEqual(rootRole);
    expect(cachedDestinationRole(execSql, system)).toEqual(systemRole);
    expect(
      cachedDestinationRole(execSql, { ...root, id: "ordinary-0" }),
    ).toBeUndefined();
    expect(
      cachedDestinationRole(execSql, { ...root, id: "ordinary-1000" }),
    ).toEqual(ordinaryRole);
  } finally {
    close();
  }
});
