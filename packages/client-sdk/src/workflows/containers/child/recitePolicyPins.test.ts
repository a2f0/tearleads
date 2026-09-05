import { expect, test } from "bun:test";
import {
  verifyContainerAccessManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { reciteResponse } from "../../../../test/helpers/containerReciteFixtures";
import {
  createPrincipalReciteFixture,
  GROUP_ID,
  ORGANIZATION_ID,
  ROOT_CONTAINER_ID,
  USER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import { heldContainerSnapshot } from "../../../data/containers/shared/heldContainerHeads";
import { readCanonicalJson } from "../../../data/keyingCanonicalJson";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification";
import {
  readAccessEvent,
  readAccessManifest,
} from "../../../data/keyingProjectionVerification/readers";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../../../data/persistence/keyingCheckpointPersistence";
import { buildMaterializedContainerCreatePlan } from "./create";
import { childContainerWriterProjectionFromCreatePlan } from "./createProjection";
import { reciteHeldDescendants } from "./recite";

test.each([
  "before-pass",
  "in-flight",
] as const)("a policy revocation %s cannot advance descendants using stale held membership", async (timing) => {
  const fixture = await createPrincipalReciteFixture({
    databaseName: `recite-policy-pins-${timing}`,
    rotateKey: true,
    nextUserId: "replacement-admin",
  });
  const execSql = fixture.database.execSql;
  try {
    const parentProjection =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!parentProjection) throw new Error("Expected parent projection");
    const paths = new Map<
      string,
      Awaited<ReturnType<typeof verifyContainerWriterProjection>>
    >();
    for (const containerId of ["held-policy-child-1", "held-policy-child-2"]) {
      const materializedPlan = await buildMaterializedContainerCreatePlan({
        author: fixture.input.author,
        containerId,
        execSql,
        parentProjection,
        parentSecretKey: fixture.input.targetSecretKey,
        resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
      });
      paths.set(
        containerId,
        await verifyContainerWriterProjection({
          execSql,
          projection: childContainerWriterProjectionFromCreatePlan({
            materializedPlan,
            parentProjection,
          }),
          resolveUserKey: fixture.input.resolveTrustedUserIdentity,
        }),
      );
    }
    const held = heldContainerSnapshot(execSql, ORGANIZATION_ID);
    const previousPolicy = held.policies.find(
      (policy) => policy.principalId === GROUP_ID,
    );
    expect(previousPolicy?.projection.map((member) => member.userId)).toContain(
      USER_ID,
    );
    expect(
      fixture.input.nextPolicy.projection.map((member) => member.userId),
    ).not.toContain(USER_ID);
    const revokeMembership = () =>
      advanceKeyingCheckpointsAtomically({
        access: [],
        execSql,
        organizationId: ORGANIZATION_ID,
        policies: [fixture.input.nextPolicy],
      });
    if (timing === "before-pass") await revokeMembership();
    const attempts: string[] = [];
    const incidents: unknown[] = [];
    await reciteHeldDescendants({
      execSql,
      author: fixture.input.author,
      ancestorIds: [ROOT_CONTAINER_ID],
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
      apiClient: {
        reciteContainer: async (id, request) => {
          attempts.push(id);
          const path = paths.get(id);
          if (!path) throw new Error("Unexpected descendant");
          const previousManifest = path.at(-1);
          if (!previousManifest) throw new Error("Expected prior descendant");
          const event = await verifySignedAccessEvent({
            body: readCanonicalJson(request.body, "Recitation body"),
            event: readAccessEvent(request.event, "Recitation event"),
            signerPublicKey: fixture.signingPublicKey,
          });
          if (!event.ok) throw event.error;
          const verified = await verifyContainerAccessManifest({
            event: event.value,
            expectedManifestHash: request.expectedManifestHash,
            manifest: readAccessManifest(
              request.manifest,
              "Recitation manifest",
            ),
            previousManifest,
            previousContainerPath: path,
            principalPolicies: held.policies,
          });
          if (!verified.ok) throw verified.error;
          // A server can echo this exact signed plan. Meanwhile another local
          // verification learns the newer policy, without refreshing held state.
          await revokeMembership();
          return reciteResponse(verified.value);
        },
      },
    });
    expect(attempts).toHaveLength(timing === "before-pass" ? 0 : 1);
    expect(incidents).toEqual([]);
    expect(
      (await loadPrincipalPolicyCheckpoint(execSql, "group", GROUP_ID))
        ?.stateHash,
    ).toBe(fixture.input.nextPolicy.stateHash);
    expect(
      heldContainerSnapshot(execSql, ORGANIZATION_ID).policies.find(
        (policy) => policy.principalId === GROUP_ID,
      )?.stateHash,
    ).toBe(previousPolicy?.stateHash);
    for (const id of paths.keys()) {
      expect(
        (
          await loadAccessManifestCheckpoint(
            execSql,
            "container",
            ORGANIZATION_ID,
            id,
          )
        )?.epoch,
      ).toBe(1);
    }
  } finally {
    fixture.database.close();
  }
});
