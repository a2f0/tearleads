import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createGroupNameDirectory } from "../../../test/helpers/groupNameDirectory";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { organizationReadModelSnapshot } from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  ensureDocumentTables,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import { containerTables } from "../../data/sqlite/schema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import {
  disposeDomainSyncCoordinator,
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import {
  denyOrganizationPresentationAccess,
  wasOrganizationPresentationAccessDeniedByServer,
} from "../../workflows/organizations/organizationPresentationAccessState";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

async function signedReadModelFixture() {
  const fixture = await createGroupNameDirectory();
  const organizationId = fixture.author.organizationId;
  const userId = fixture.author.signerUserId;
  const organization = await fixture.apiClient.getCurrentPrincipalPolicy(
    "organization",
    organizationId,
  );
  if (!organization) throw new Error("Expected signed organization policy");
  const policies = [fixture.servedGroups["admins-group"], fixture.memberPolicy];
  const snapshot = organizationReadModelSnapshot({
    organizationId,
    currentUserId: userId,
  });
  const identity = await fixture.resolveTrustedUserIdentity(userId);
  if (!identity) throw new Error("Expected trusted founder identity");
  const member = {
    userId,
    role: "admin" as const,
    signingKeyFingerprint: identity.signingKeyFingerprint,
    signingPublicKey: bytesToBase64(identity.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
    encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
  };
  snapshot.lanes.directory.users = snapshot.lanes.directory.users
    .filter((user) => user.userId === userId)
    .map((user) => ({ ...user, ...member }));
  snapshot.lanes.organizationPolicy.currentState = {
    ...organization.currentState,
    memberCount: organization.currentProjection.length,
  };
  snapshot.lanes.groups = {
    organizationId,
    memberGroupId: "members-group",
    groups: policies.slice(0, 1).map((bundle) => {
      if (!bundle) throw new Error("Expected signed group policy");
      return {
        organizationId,
        groupId: bundle.currentState.principalId,
        createdAt: bundle.currentState.createdAt,
        isBuiltin: true,
        currentState: {
          ...bundle.currentState,
          memberCount: bundle.currentProjection.length,
        },
      };
    }),
  };
  snapshot.lanes.groupMemberships = {
    organizationId,
    deletedGroupIds: [],
    groups: policies.map((bundle) => {
      if (!bundle) throw new Error("Expected signed group policy");
      return {
        groupId: bundle.currentState.principalId,
        stateHash: bundle.currentState.stateHash,
        members: [member],
      };
    }),
  };
  snapshot.lanes.grants = { organizationId, grants: [] };
  return { ...fixture, organizationId, organization, snapshot, userId };
}

async function parkDeniedWritesAndMoves(
  execSql: ExecSql,
  organizationId: string,
) {
  await ensureDocumentTables(execSql);
  await recordDocumentSyncFailure(
    execSql,
    { appKind: "documents", localId: "stranded-write" },
    {
      attemptedAt: "2026-09-17T00:00:00.000Z",
      message: "Write access denied by the server (403)",
      status: 403,
    },
  );
  await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, containerTables);
  for (const [id, org] of [
    ["restored", organizationId],
    ["foreign", "other-org"],
  ] as const) {
    await execSql(
      `INSERT INTO containers (id, organization_id, local_created_at, local_updated_at)
      VALUES (?, ?, '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z')`,
      [id, org],
    );
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: `${id}-remote`,
      localId: `${id}-local`,
      targetContainerId: id,
    });
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: `${id}-remote`,
      message: "permission denied",
    });
  }
}

test("name hydration failure cannot consume the denied-access write recovery edge", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-name-hydration-recovery",
  );
  const fixture = await signedReadModelFixture();
  let tamperSignature = true;
  let rejectedPolicyReads = 0;
  const logs: unknown[] = [];
  const access = {
    execSql,
    organizationId: fixture.organizationId,
    requesterUserId: fixture.userId,
  };
  const input = createWorkflowInputFixture({
    apiClient: createMockApiClient({
      getOrganizationReadModelResult: async () => ({
        data: fixture.snapshot,
        ok: true,
      }),
      getCurrentPrincipalPolicy: async (type, id) => {
        if (type === "organization" && tamperSignature) {
          rejectedPolicyReads += 1;
          expect(
            wasOrganizationPresentationAccessDeniedByServer(
              access,
              "readModel",
            ),
          ).toBe(false);
          return {
            ...fixture.organization,
            currentState: {
              ...fixture.organization.currentState,
              signature: "tampered-signature",
            },
          };
        }
        return fixture.apiClient.getCurrentPrincipalPolicy(type, id);
      },
    }),
    auth: { organizationId: fixture.organizationId, userId: fixture.userId },
    execSql,
    resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    logError: (...args) => {
      logs.push(args);
    },
  });
  const workflowInput = {
    ...input,
    crypto: {
      ...input.crypto,
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
    },
  };
  const domainScope = workflowInput.state.domainScope;
  try {
    await parkDeniedWritesAndMoves(execSql, fixture.organizationId);
    let laneRuns = 0;
    getOrCreateDomainSyncCoordinator(domainScope).registerLane(
      "documents:stranded",
      {
        label: "Stranded writes",
        phase: "document",
        run: async () => {
          laneRuns += 1;
        },
      },
    );
    const coordinator = createOrganizationReadModelCoordinator(
      createInternalRuntimeFixture(() => workflowInput),
    );
    denyOrganizationPresentationAccess(access, ["readModel", "usage"]);

    // Access restoration succeeds, but the real name hydrator rejects the
    // tampered policy. Presentation still fails; recovery must already happen.
    await expect(coordinator.reconcile()).rejects.toBeInstanceOf(
      KeyingVerificationError,
    );
    expect(logs).toEqual([]);
    expect(rejectedPolicyReads).toBe(1);
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(laneRuns).toBe(1);
    expect(
      (
        await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql)
      ).map((move) => move.documentId),
    ).toEqual(["restored-remote"]);
    expect(
      await sqlDocumentMoveIntentPersistence.hasDeniedMoveIntents(execSql, {
        organizationId: "other-org",
      }),
    ).toBe(true);

    tamperSignature = false;
    const restored = await coordinator.reconcile();
    expect(restored?.groups.map((group) => group.name).sort()).toEqual([
      "Admins",
    ]);
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(laneRuns).toBe(1);
    expect(
      (
        await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql)
      ).map((move) => move.documentId),
    ).toEqual(["restored-remote"]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
