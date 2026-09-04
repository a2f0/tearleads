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
import { verifiedCitedHead } from "./containerAncestorCitations";

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
      message: expect.stringContaining("does not descend"),
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

test("a served path must start at a root", async () => {
  const scenario = await createScenario();
  const { close, execSql } = await createTestExecSql("ancestor-cites-noroot");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.child1],
        path: [scenario.child1],
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});

test("a citation set naming two verified heads of one container is refused", async () => {
  // An event cites one head per container; two verified ones is a served
  // citation set that was tampered with, whichever the rule would pick.
  const scenario = await createScenario();
  const verifiedByHash = new Map([
    [scenario.root1.manifestHash, scenario.root1],
    [scenario.root2.manifestHash, scenario.root2],
  ]);
  expect(() =>
    verifiedCitedHead({
      cited: [scenario.root1.manifestHash, scenario.root2.manifestHash],
      containerId: ROOT_ID,
      label: "Ancestor citation path[1]",
      verifiedByHash,
    }),
  ).toThrow(/more than one head/);
  expect(
    verifiedCitedHead({
      cited: [scenario.root2.manifestHash],
      containerId: ROOT_ID,
      label: "Ancestor citation path[1]",
      verifiedByHash,
    })?.manifestHash,
  ).toBe(scenario.root2.manifestHash);
});

test("a device that checkpointed the child still accepts a head citing an older ancestor head", async () => {
  const scenario = await createScenario();
  // Mallory, revoked at root2, signs a child event citing root1. A device
  // that holds the child cannot tell her last honest share, delivered late,
  // from a share forged with the server's help, and an honest server serves
  // this shape routinely; refusing it would leave every device holding the
  // child unable to supersede it. The API refuses the forgery at commit.
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-held");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
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

test("a served ancestor head older than the one a head cites is a rollback", async () => {
  const scenario = await createScenario();
  // Committed against root2: the signed event proves root2 exists, so a
  // server presenting root1 as current is stale or forked.
  const child2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-reversed");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
        path: [scenario.root1, child2],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining(
        "the served current head does not descend from",
      ),
    });
  } finally {
    close();
  }
});
