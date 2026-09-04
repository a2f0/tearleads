import { expect, test } from "bun:test";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointChildAt,
  createScenario,
  grantBy,
  ORGANIZATION_ID,
  ROOT_ID,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";

// A child manifest pins the parent it was created under, and successors
// inherit that pin, so a member revoked from an ancestor could keep signing
// child events that verify against the manifest that still granted them.
// Every container event signs the ancestor heads it was committed against,
// so the verifier authorizes a head at those cited heads and refuses a head
// that cites an older ancestor head than an earlier signed statement proved.

test("a head is authorized at the ancestor heads its event cites", async () => {
  const scenario = await createScenario();
  // Signed while root1 was current, which is what its citation says.
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-cold");
  try {
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
    });
    expect(verified.map((manifest) => manifest.manifestHash)).toEqual([
      scenario.root2.manifestHash,
      child2.manifestHash,
    ]);
  } finally {
    close();
  }
});

test("a head already checkpointed keeps verifying after its ancestor moved on", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-seen");
  try {
    await checkpointChildAt(scenario, execSql, child2, [
      scenario.root1,
      scenario.child1,
      child2,
    ]);
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("a head must not cite an older parent head than its predecessor cited", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  // child2 proved root2 predates it; a later head citing root1 is a rollback
  // even for a device with no checkpoint.
  const forged = await grantBy({
    cited: [scenario.root1.manifestHash, child2.manifestHash],
    previous: child2,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-regress");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.child1,
          child2,
          forged,
        ],
        path: [scenario.root2, forged],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("older head"),
    });
  } finally {
    close();
  }
});

test("a head must cite a served head of its parent container", async () => {
  const scenario = await createScenario();
  const uncited = await grantBy({
    cited: [scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-missing");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, uncited],
        path: [scenario.root2, uncited],
      }),
    ).rejects.toMatchObject({
      code: "missing_dependency",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});

test("a served path must be a root-to-leaf ancestor chain", async () => {
  const scenario = await createScenario();
  const { close, execSql } = await createTestExecSql("ancestor-cites-chain");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1],
        path: [scenario.child1, scenario.root2],
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});

test("a head must cite exactly one head of its parent container", async () => {
  const scenario = await createScenario();
  const ambiguous = await grantBy({
    cited: [
      scenario.root1.manifestHash,
      scenario.root2.manifestHash,
      scenario.child1.manifestHash,
    ],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-twice");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, ambiguous],
        path: [scenario.root2, ambiguous],
      }),
    ).rejects.toMatchObject({
      code: "duplicate_entry",
      message: expect.stringContaining("more than one head"),
    });
  } finally {
    close();
  }
});

test("a create must cite the parent manifest it pins", async () => {
  const scenario = await createScenario();
  const uncited = await createContainerManifestFixture({
    containerId: "ancestor-uncited-child",
    containerKeyEpochId: "uncited-key-1",
    directGrants: [],
    event: await createVerifiedContainerAccessEvent({
      body: {
        eventType: "container.create",
        parentContainerId: ROOT_ID,
        parentManifestHash: scenario.root2.manifestHash,
        metadataDocumentId: "ancestor-uncited-child-metadata-document",
        containerKeyEpochId: "uncited-key-1",
        directGrants: [],
        referencedPrincipalHeads: [],
      },
      dependencyManifestHashes: [],
      objectId: "ancestor-uncited-child",
      organizationId: ORGANIZATION_ID,
      previousManifestHash: null,
      signer: scenario.alice.keyPair,
      signerUserId: scenario.alice.userId,
    }),
    organizationId: ORGANIZATION_ID,
    parentContainerId: ROOT_ID,
    parentManifestHash: scenario.root2.manifestHash,
    signer: scenario.alice.keyPair,
    signerUserId: scenario.alice.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-create-uncited");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, uncited],
        path: [scenario.root2, uncited],
      }),
    ).rejects.toMatchObject({
      code: "missing_dependency",
      message: expect.stringContaining("created under"),
    });
  } finally {
    close();
  }
});
