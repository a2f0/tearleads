import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { cachedDestinationRole } from "../container-contents/remoteHydration/destination/destinationRoleCache";
import {
  createProvisionedContainerSeeder,
  type ProvisionedContainerSeed,
} from "./provisionedContainerSeeds";

const organizationId = "organization";
const userId = "founder";
const fingerprint = "founder-key";
const database = {} as ExecSqlClientLike;

function seed(input: {
  containerId: string;
  parentContainerId: string | null;
  systemSlot: string | null;
  acknowledged?: string | undefined;
}): ProvisionedContainerSeed {
  const manifestHash = `${input.containerId}-head`;
  return {
    acknowledgedManifestHash: input.acknowledged ?? manifestHash,
    plan: {
      containerId: input.containerId,
      event: { signerKeyFingerprint: fingerprint, signerUserId: userId },
      manifestHash,
      state: {
        containerId: input.containerId,
        epoch: 1,
        metadataDocumentId: `${input.containerId}-metadata`,
        organizationId,
        parentContainerId: input.parentContainerId,
        systemSlot: input.systemSlot,
      },
    },
  };
}

async function provisioned(acknowledgedTrash?: string) {
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  return [
    seed({ containerId: "root", parentContainerId: null, systemSlot: null }),
    seed({
      containerId: "metadata",
      parentContainerId: null,
      systemSlot: metadataSlot,
    }),
    seed({
      acknowledged: acknowledgedTrash,
      containerId: "trash",
      parentContainerId: "root",
      systemSlot: "trash-slot",
    }),
    seed({
      containerId: "folder",
      parentContainerId: "root",
      systemSlot: null,
    }),
  ];
}

async function seedWith(input: {
  containers: readonly ProvisionedContainerSeed[];
  execSql: ExecSql;
  rootContainerId?: string;
  signingFingerprint?: string;
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  await createProvisionedContainerSeeder({
    execSqlFor: (candidate) => (candidate === database ? input.execSql : null),
    logError: (_message, cause) => errors.push(cause),
    signingFingerprint: () => input.signingFingerprint ?? fingerprint,
  })({
    containers: input.containers,
    database,
    isCurrent: () => true,
    rootContainerId: input.rootContainerId ?? "root",
    userId,
  });
  return errors;
}

function role(execSql: ExecSql, id: string) {
  return cachedDestinationRole(execSql, { id, organizationId });
}

test("provisioning seeds the roles hydration would verify from signed paths", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    expect(
      await seedWith({ containers: await provisioned(), execSql }),
    ).toEqual([]);
    const rootRole = {
      createSignerUserId: userId,
      rootContainerId: "root",
      rootCreateManifestHash: "root-head",
      rootMetadataDocumentId: "root-metadata",
    };
    expect(role(execSql, "root")).toEqual({
      ...rootRole,
      metadataDocumentId: "root-metadata",
      parentId: null,
      systemSlot: null,
    });
    expect(role(execSql, "metadata")).toMatchObject({
      parentId: null,
      rootContainerId: "metadata",
      rootCreateManifestHash: "metadata-head",
    });
    expect(role(execSql, "trash")).toEqual({
      ...rootRole,
      metadataDocumentId: "trash-metadata",
      parentId: "root",
      systemSlot: "trash-slot",
    });
    // An ordinary parent edge can move, so it is never seeded.
    expect(role(execSql, "folder")).toBeUndefined();
  } finally {
    close();
  }
});

test("only the acknowledged session root and its children are seeded under it", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    await seedWith({
      containers: await provisioned(),
      execSql,
      rootContainerId: "another-root",
    });
    expect(role(execSql, "root")).toBeUndefined();
    expect(role(execSql, "trash")).toBeUndefined();
    expect(role(execSql, "metadata")).toBeDefined();
  } finally {
    close();
  }
});

test("a head the response did not acknowledge is left to verification", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    await seedWith({
      containers: await provisioned("other-head"),
      execSql,
    });
    expect(role(execSql, "trash")).toBeUndefined();
    expect(role(execSql, "root")).toBeDefined();
  } finally {
    close();
  }
});

test("another signing identity or a switched database seeds nothing", async () => {
  const { execSql, close } = createNativeTestExecSql();
  const other = createNativeTestExecSql();
  try {
    const containers = await provisioned();
    await seedWith({ containers, execSql, signingFingerprint: "other-key" });
    expect(role(execSql, "root")).toBeUndefined();
    expect(role(execSql, "metadata")).toBeUndefined();
    // The host replaces the database while the seeder derives the slot.
    let reads = 0;
    const errors: unknown[] = [];
    await createProvisionedContainerSeeder({
      execSqlFor: () => (reads++ < 2 ? execSql : other.execSql),
      logError: (_message, cause) => errors.push(cause),
      signingFingerprint: () => fingerprint,
    })({
      containers,
      database,
      isCurrent: () => true,
      rootContainerId: "root",
      userId,
    });
    expect(errors).toEqual([]);
    expect(role(execSql, "root")).toBeUndefined();
    expect(role(other.execSql, "root")).toBeUndefined();
  } finally {
    other.close();
    close();
  }
});
