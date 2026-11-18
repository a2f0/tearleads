import { expect, test } from "bun:test";
import {
  accessManifestCheckpointFromManifest,
  computeAccessManifestBundleDigest,
} from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/container-access-test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";
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
