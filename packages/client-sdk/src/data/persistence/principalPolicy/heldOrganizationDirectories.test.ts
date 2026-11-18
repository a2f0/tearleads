import { expect, test } from "bun:test";
import {
  citationDatabase,
  entry,
  hash,
  NOW,
  ORGANIZATION,
  remember,
} from "../../../../test/helpers/data/verifiedCitationReads";
import {
  principalPolicyBundles,
  principalPolicyTables,
} from "../../sqlite/schema/principalPolicySchema";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { loadVerifiedManifestCitations } from "../verifiedManifestBundlePersistence";
import { heldDirectoryCitations } from "./heldOrganizationDirectories";

function stateOf(stateHash: string, principalId = ORGANIZATION) {
  return {
    createdAt: NOW,
    encapsulationPublicKey: "key",
    externalAuthority: null,
    grantCount: 0,
    grantRoot: "grant-root",
    keyEpoch: 1,
    keyFingerprint: "fingerprint",
    memberCount: 1,
    memberEnvelopesRoot: "envelopes-root",
    membershipMode: "projection",
    membershipRoot: "membership-root",
    payloadCiphertextHash: "payload-hash",
    prevStateHash: null,
    principalId,
    principalType: "organization",
    projectionRoot: "projection-root",
    signature: "signature",
    signedAt: NOW,
    signerUserId: "user-1",
    signerUserKeyFingerprint: "signer",
    stateHash,
    version: 1,
  };
}

function payloadOf(stateHash: string, principalId = ORGANIZATION) {
  return {
    cipherSuite: "aes-256-gcm" as const,
    ciphertext: `directory-${stateHash.slice(-2)}`,
    ciphertextHash: "payload-hash",
    createdAt: NOW,
    principalId,
    principalType: "organization" as const,
    stateHash,
  };
}

function bundleRow(input: {
  readonly stateHash: string;
  readonly isCurrent: boolean;
  readonly updatedAt: string;
  readonly principalId?: string;
  readonly stateJson?: string;
}) {
  const principalId = input.principalId ?? ORGANIZATION;
  return {
    principalType: "organization",
    principalId,
    stateHash: input.stateHash,
    isCurrent: input.isCurrent,
    currentStateJson:
      input.stateJson ?? JSON.stringify(stateOf(input.stateHash, principalId)),
    currentPayloadJson: JSON.stringify(payloadOf(input.stateHash, principalId)),
    currentProjectionJson: "[]",
    currentGrantsJson: "[]",
    currentMemberEnvelopesJson: "[]",
    previousStatesJson: "[]",
    updatedAt: input.updatedAt,
  };
}

test("a projection read cites the organization's held directory payloads, current first", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("c0", null);
    await remember(fixture.execSql, [entry("c0", 1, 1)]);
    await ensureSqlTables(fixture.execSql, principalPolicyTables);
    await fixture.db
      .insert(principalPolicyBundles)
      .values([
        bundleRow({
          stateHash: hash(10),
          isCurrent: false,
          updatedAt: "2026-01-03T00:00:00.000Z",
        }),
        bundleRow({ stateHash: hash(11), isCurrent: true, updatedAt: NOW }),
        // Another organization's directory is never cited here.
        bundleRow({
          stateHash: hash(12),
          isCurrent: true,
          updatedAt: NOW,
          principalId: "organization-2",
        }),
        // A row whose state does not name its own hash is skipped.
        bundleRow({
          stateHash: hash(13),
          isCurrent: false,
          updatedAt: "2026-01-02T00:00:00.000Z",
          stateJson: JSON.stringify(stateOf(hash(14))),
        }),
        // A row filed under this organization whose state names another
        // organization is skipped too.
        bundleRow({
          stateHash: hash(15),
          isCurrent: false,
          updatedAt: "2026-01-02T00:00:00.000Z",
          stateJson: JSON.stringify(stateOf(hash(15), "organization-2")),
        }),
        ...Array.from({ length: 8 }, (_, index) =>
          bundleRow({
            stateHash: hash(20 + index),
            isCurrent: false,
            updatedAt: "2025-12-01T00:00:00.000Z",
          }),
        ),
      ])
      .run();
    const citations = await loadVerifiedManifestCitations(
      fixture.execSql,
      { kind: "container", id: "c0" },
      undefined,
      heldDirectoryCitations,
    );
    const directories = citations.flatMap((citation) =>
      "directoryState" in citation ? [citation] : [],
    );
    // At most eight rows are read: the current state, then the most
    // recently stored; the two damaged rows take slots and are dropped.
    expect(
      directories.map(({ directoryState }) => directoryState.stateHash),
    ).toEqual([
      hash(11),
      hash(10),
      ...Array.from({ length: 4 }, (_, index) => hash(20 + index)),
    ]);
    expect(directories[0]?.directoryPayload).toEqual(payloadOf(hash(11)));
    // The manifest citations are unchanged.
    expect(
      citations.flatMap((citation) =>
        "manifestHash" in citation ? [citation.manifestHash] : [],
      ),
    ).toEqual([hash(1)]);
  } finally {
    fixture.close();
  }
});

test("a device that stored no policy bundle cites manifests alone", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("c0", null);
    await remember(fixture.execSql, [entry("c0", 1, 1)]);
    const citations = await loadVerifiedManifestCitations(
      fixture.execSql,
      { kind: "container", id: "c0" },
      undefined,
      heldDirectoryCitations,
    );
    expect(
      citations.map((citation) => Reflect.get(citation, "manifestHash")),
    ).toEqual([hash(1)]);
  } finally {
    fixture.close();
  }
});

test("a stalled or failing directory read never costs the manifest citations", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("c0", null);
    await remember(fixture.execSql, [entry("c0", 1, 1)]);
    for (const source of [
      // Never answers: the manifest citations wait only the directory
      // budget, well inside the API client's citation deadline.
      () => new Promise<never>(() => undefined),
      () => Promise.reject(new Error("policy store unavailable")),
    ]) {
      const startedAt = performance.now();
      const citations = await loadVerifiedManifestCitations(
        fixture.execSql,
        { kind: "container", id: "c0" },
        undefined,
        source,
      );
      expect(
        citations.map((citation) => Reflect.get(citation, "manifestHash")),
      ).toEqual([hash(1)]);
      // The API client's citation deadline (MANIFEST_CITATION_DEADLINE_MS).
      expect(performance.now() - startedAt).toBeLessThan(250);
    }
  } finally {
    fixture.close();
  }
});
