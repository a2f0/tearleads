import { expect, test } from "bun:test";
import {
  acknowledgePolicy,
  adoptionAccessHeads,
  organizationAdoptionFixture,
  signSuccessorPolicy,
} from "../../../../test/helpers/organizationAdoption";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { advanceLocallyAcknowledgedAccessManifestHeadsAtomically } from "../../../data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../../data/persistence/principalPolicy/principalPolicyPersistence";

// Every head family is exercised together: root, reserved and app-owned
// containers, their metadata documents and both profile documents.
test.each([true, false])(
  "ordinary adoption preserves advanced access heads (cached discovery: %s)",
  async (cached) => {
    const fixture = await organizationAdoptionFixture();
    const { execSql, request } = fixture;
    try {
      const genesis = await adoptionAccessHeads(request);
      expect(genesis).toHaveLength(10);
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql,
        heads: genesis,
      });
      const advanced = genesis.map((head, index) => ({
        checkpoint: {
          ...head.checkpoint,
          epoch: 2,
          manifestHash: (index + 1).toString(16).repeat(64),
        },
        previousManifestHash: head.checkpoint.manifestHash,
      }));
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql,
        heads: advanced,
      });
      const store = createDocumentDiscoveryEvidenceStore(execSql);
      const generation = await store.begin();
      const profiles = advanced.filter(
        ({ checkpoint }) =>
          checkpoint.objectKind === "document" &&
          [
            fixture.response.rosterProfileDocumentId,
            fixture.response.organizationProfileDocumentId,
          ].includes(checkpoint.objectId),
      );
      expect(profiles).toHaveLength(2);
      for (const { checkpoint } of cached ? profiles : []) {
        await store.saveHead(
          checkpoint.objectId,
          {
            organizationId: request.organizationId,
            accessEpoch: 2,
            accessStateHash: checkpoint.manifestHash,
            linkedContainerIds: ["later-placement"],
          },
          generation,
        );
      }
      const before = await execSql(
        "SELECT * FROM document_discovery_heads ORDER BY document_id",
      );
      expect(await fixture.retry()).toEqual(fixture.response);
      for (const { checkpoint } of advanced) {
        expect(
          await loadAccessManifestCheckpoint(
            execSql,
            checkpoint.objectKind,
            checkpoint.organizationId,
            checkpoint.objectId,
          ),
        ).toEqual(checkpoint);
      }
      expect(
        await execSql(
          "SELECT * FROM document_discovery_heads ORDER BY document_id",
        ),
      ).toEqual(before);
      // An advanced pin with no hydrated body must not be filled with genesis
      // key bundles or admin projections; normal discovery will supply it.
      expect(
        await sqlContainerContentsPersistence.loadContainers(execSql),
      ).toEqual([]);
      expect(await execSql("SELECT * FROM documents")).toEqual([]);
      expect(
        await execSql(
          "SELECT organization_id FROM organization_provisioning_attempts",
        ),
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  },
);

test("adoption skips an advanced root but still finishes missing siblings", async () => {
  const fixture = await organizationAdoptionFixture();
  const { execSql, request, response } = fixture;
  try {
    const root = (await adoptionAccessHeads(request)).find(
      (head) =>
        head.checkpoint.objectKind === "container" &&
        head.checkpoint.objectId === request.rootContainerId,
    );
    if (!root) throw new Error("Missing root head");
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [root],
    });
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [
        {
          checkpoint: {
            ...root.checkpoint,
            epoch: 2,
            manifestHash: "e".repeat(64),
          },
          previousManifestHash: root.checkpoint.manifestHash,
        },
      ],
    });
    expect(await fixture.retry()).toEqual(response);
    const containers =
      await sqlContainerContentsPersistence.loadContainers(execSql);
    const rosterId = response.rosterProfileContainerId;
    if (!rosterId) throw new Error("Missing roster container");
    expect(containers.map(({ container }) => container.id).sort()).toEqual(
      [
        rosterId,
        response.organizationMetadataContainerId,
        ...response.systemContainers.map(
          ({ container }) => container.containerId,
        ),
      ].sort(),
    );
    // Three sibling metadata documents and both profiles are materialized.
    expect(await execSql("SELECT * FROM documents")).toHaveLength(5);
    expect(
      await execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});

test.each(["admin", "member", "organization"] as const)(
  "ordinary adoption preserves a later %s policy and completes the attempt",
  async (kind) => {
    const fixture = await organizationAdoptionFixture();
    const { execSql, request } = fixture;
    try {
      const genesis = fixture.policies[kind];
      await acknowledgePolicy(execSql, request.organizationId, genesis);
      const advanced = await signSuccessorPolicy(
        genesis,
        fixture.input.signingKeyPair.signingPrivateKey,
      );
      await acknowledgePolicy(execSql, request.organizationId, advanced);
      const state = advanced.currentState;
      const before = await loadPrincipalPolicyCheckpoint(
        execSql,
        state.principalType,
        state.principalId,
      );
      expect(before?.version).toBe(2);
      expect(await fixture.retry()).toEqual(fixture.response);
      expect(fixture.requests).toEqual([request, request]);
      expect(
        await loadPrincipalPolicyCheckpoint(
          execSql,
          state.principalType,
          state.principalId,
        ),
      ).toEqual(before);
      expect(
        await loadPrincipalPolicyBundle(
          execSql,
          state.principalType,
          state.principalId,
        ),
      ).toEqual(advanced);
      expect(
        await execSql(
          "SELECT organization_id FROM organization_provisioning_attempts",
        ),
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  },
);
