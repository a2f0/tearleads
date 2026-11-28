import { expect, test } from "bun:test";
import {
  accessManifestCheckpointFromManifest,
  computeAccessManifestBundleDigest,
  computeContainerKekLevelDigest,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/container-access-test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";
import { acknowledgeContainerMutation } from "../../containers/shared/mutationAcknowledgement";
import { KeyingCheckpointRepository } from "../keyingCheckpoints/keyingCheckpointRepository";
import { loadVerifiedManifestCitations } from "../verifiedManifestBundlePersistence";
import { acknowledgedAuthoredBundle } from "./authoredBundleCitation";

const ADMIN = {
  accessLevel: "admin",
  subjectId: "user-1",
  subjectType: "user",
} as const;

async function authoredRoot() {
  const verified = await createContainerManifestFixture({
    containerId: "authored-root",
    containerKeyEpochId: "epoch-1",
    directGrants: [ADMIN],
    signerUserId: "user-1",
  });
  const plan = {
    body: verified.event.body,
    event: verified.event.event,
    eventHash: verified.event.eventHash,
    manifest: verified.manifest,
    manifestHash: verified.manifestHash,
    state: verified.state,
  };
  // The digest the API names: its own records of the stored event, manifest
  // and state, in the served form.
  const served = toServedAccessManifestBundle({
    event: {
      body: verified.event.body,
      event: { ...verified.event.event },
      eventHash: verified.event.eventHash,
    },
    manifest: { ...verified.manifest },
    manifestHash: verified.manifestHash,
    state: { ...verified.state },
  });
  const digest = await computeAccessManifestBundleDigest(served);
  if (!digest) throw new Error("fixture bundle is not canonical");
  return { digest, plan, served };
}

test("only a matching acknowledgement digest yields the authored bundle", async () => {
  const { digest, plan, served } = await authoredRoot();
  expect(await acknowledgedAuthoredBundle(plan, digest)).toEqual(served);
  expect(await acknowledgedAuthoredBundle(plan, "0".repeat(64))).toBeNull();
});

test("the acknowledgement transaction stores a matched authored bundle for citation", async () => {
  const { digest, plan, served } = await authoredRoot();
  const database = await createTestExecSql("authored-bundle-citation");
  const target = { kind: "container", id: "authored-root" } as const;
  try {
    const head = {
      checkpoint: accessManifestCheckpointFromManifest(plan),
      previousManifestHash: null,
    };
    expect(
      await new KeyingCheckpointRepository(
        database.execSql,
      ).advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        heads: [
          {
            ...head,
            servedBundle: await acknowledgedAuthoredBundle(plan, digest),
          },
        ],
      }),
    ).toBe(true);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([served]);
  } finally {
    database.close();
  }
});

test("an unmatched acknowledgement stores the pin but nothing to cite", async () => {
  const { plan } = await authoredRoot();
  const database = await createTestExecSql("authored-bundle-unmatched");
  try {
    await new KeyingCheckpointRepository(
      database.execSql,
    ).advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      heads: [
        {
          checkpoint: accessManifestCheckpointFromManifest(plan),
          previousManifestHash: null,
          servedBundle: await acknowledgedAuthoredBundle(plan, "0".repeat(64)),
        },
      ],
    });
    expect(
      await new KeyingCheckpointRepository(
        database.execSql,
      ).loadAccessManifestCheckpoint(
        "container",
        plan.manifest.organizationId,
        "authored-root",
      ),
    ).toMatchObject({ manifestHash: plan.manifestHash });
    expect(
      await loadVerifiedManifestCitations(database.execSql, {
        kind: "container",
        id: "authored-root",
      }),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

test("container mutation acknowledgement caches both served bundle and authored KEK level", async () => {
  const { digest, plan, served } = await authoredRoot();
  const keyEpoch = {
    id: "epoch-1",
    containerId: "authored-root",
    keyEpoch: 1,
    accessManifestHash: plan.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: plan.eventHash,
    createdByManifestHash: plan.manifestHash,
  };
  const wraps = [
    {
      containerKeyEpochId: "epoch-1",
      recipientKind: "user" as const,
      recipientId: "user-1",
      recipientKeyEpochId: "user-epoch-1",
      recipientKeyFingerprint: "1".repeat(64),
      kemCipherText: "kem-ct",
      wrappedKey: "wrapped-key",
      wrapManifestHash: plan.manifestHash,
    },
  ];
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const keyTargetHash = await computeContainerKekRecipientTargetHash([
    {
      recipientKind: "user",
      recipientId: "user-1",
      recipientKeyEpochId: "user-epoch-1",
      recipientKeyFingerprint: "1".repeat(64),
    },
  ]);
  const database = await createTestExecSql("authored-kek-citation");
  if (!plan.body || typeof plan.body !== "object") {
    throw new Error("fixture body is not an object");
  }
  const body = plan.body;
  try {
    expect(
      await acknowledgeContainerMutation({
        execSql: database.execSql,
        plan: {
          ...plan,
          body,
          containerId: "authored-root",
          keyEpoch,
          wraps,
        },
        response: {
          containerId: "authored-root",
          organizationId: plan.state.organizationId,
          parentId: null,
          systemSlot: null,
          createdAt: "2026-11-28T00:00:00.000Z",
          updatedAt: "2026-11-28T00:00:00.000Z",
          eventHash: plan.eventHash,
          bundleDigest: digest,
          manifestHead: {
            epoch: plan.state.epoch,
            manifestHash: plan.manifestHash,
          },
          containerKek: {
            containerKeyEpochId: "epoch-1",
            containerKeyEpoch: 1,
            keyEpochHash,
            keyTargetHash,
            keyringHash: null,
            parentContainerKeyEpochId: null,
          },
        },
      }),
    ).toBe(true);
    const cited = await loadVerifiedManifestCitations(database.execSql, {
      kind: "container",
      id: "authored-root",
    });
    expect(cited).toHaveLength(2);
    const [citedLevel, citedBundle] = cited;
    expect(citedBundle).toEqual(served);
    expect(citedLevel).toMatchObject({
      containerId: "authored-root",
      accessManifestHash: plan.manifestHash,
      containerKeyEpochId: "epoch-1",
      containerKeyEpoch: 1,
      keyring: null,
      containerManifestHistory: [],
      keyEpochHash,
      keyTargetHash,
    });
    // Digest matches a server KEK level whose containerManifestHistory is populated.
    expect(await computeContainerKekLevelDigest(citedLevel)).toBe(
      await computeContainerKekLevelDigest({
        ...citedLevel,
        containerManifestHistory: [plan.manifestHash],
      }),
    );
  } finally {
    database.close();
  }
});
