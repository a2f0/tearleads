import { expect, test } from "bun:test";
import { createContainerMutationResponseFromRequest } from "@tearleads/test-utils";
import { createParentProjectionUserKeyResolver } from "../../../../test/helpers/containerFixtures";
import { createContainerReciteScenario } from "../../../../test/helpers/containerReciteFixtures";
import { rememberAcknowledgedContainerHead } from "../../../data/containers/shared/heldContainerHeads";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { reciteHeldDescendants } from "./recite";
import { buildMaterializedContainerRevokePlan } from "./revoke";

test("self-revocation never signs or submits descendant recitations for a server to echo", async () => {
  const scenario = await createContainerReciteScenario();
  try {
    const { parent } = scenario;
    const { plan } = await buildMaterializedContainerRevokePlan({
      author: parent.author,
      execSql: scenario.execSql,
      previousProjection: parent.projection,
      revokedSubject: { subjectType: "user", subjectId: parent.userId },
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    });
    const response = await createContainerMutationResponseFromRequest(
      plan.request,
      parent.projection.containerKeks.at(-1),
    );
    expect(
      await acknowledgeContainerMutation({
        execSql: scenario.execSql,
        plan,
        response,
      }),
    ).toBe(true);
    rememberAcknowledgedContainerHead(scenario.execSql, plan);
    expect(plan.state.directGrants).toEqual([]);
    const attempts: unknown[] = [];
    const incidents: unknown[] = [];
    await reciteHeldDescendants({
      apiClient: {
        reciteContainer: async (...args) => {
          attempts.push(args);
          throw new Error("An unauthorized signed plan reached the server");
        },
      },
      author: parent.author,
      ancestorIds: [parent.projection.containerId],
      execSql: scenario.execSql,
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    });
    expect(attempts).toEqual([]);
    expect(incidents).toEqual([]);
    for (const id of ["held-child", "held-grandchild"]) {
      expect(
        (
          await loadAccessManifestCheckpoint(
            scenario.execSql,
            "container",
            parent.author.organizationId,
            id,
          )
        )?.epoch,
      ).toBe(1);
    }
  } finally {
    await scenario.close();
  }
});
