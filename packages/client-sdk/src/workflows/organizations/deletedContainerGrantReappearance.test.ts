import { expect, test } from "bun:test";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import {
  createPrincipalReciteFixture,
  ORGANIZATION_ID,
  ROOT_CONTAINER_ID,
  SECOND_CONTAINER_ID,
} from "../../../test/helpers/principalReciteFixtures";
import { verifyContainerWriterProjection } from "../../data/keyingProjectionVerification";
import { retainLocallyAcknowledgedPrincipalPolicyBundles } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";

test("a container skipped as deleted during rotation cannot reappear under its old group key", async () => {
  const fixture = await createPrincipalReciteFixture({
    databaseName: "grant-reappearance",
    rotateKey: true,
    containerIds: [ROOT_CONTAINER_ID, SECOND_CONTAINER_ID],
  });
  try {
    const api = fixture.input.apiClient;
    const root = await api.getContainerWriterProjection(ROOT_CONTAINER_ID);
    const second = await api.getContainerWriterProjection(SECOND_CONTAINER_ID);
    if (!root || !second) throw new Error("Expected both live projections");
    const verify = () =>
      verifyContainerWriterProjection({
        execSql: fixture.database.execSql,
        projection: root,
        resolveUserKey: fixture.input.resolveTrustedUserIdentity,
      });
    await verify();
    const prepared = await preparePrincipalContainerRematerializationBatch({
      ...fixture.input,
      apiClient: {
        ...api,
        getContainerWriterProjectionResult: async (id) =>
          id === ROOT_CONTAINER_ID
            ? {
                ok: false,
                kind: "http",
                status: 404,
                code: CONTAINER_NOT_FOUND_ERROR_CODE,
                message: "gone",
                method: "GET",
                path: "/projection",
                report: () => {},
                statusText: "Not Found",
              }
            : api.getContainerWriterProjectionResult(id),
      },
    });
    expect(prepared.requests).toHaveLength(1);
    expect(prepared.retiredContainerIds).toEqual([ROOT_CONTAINER_ID]);
    // A hint alone cannot retire a container before the commit is acknowledged.
    await verify();
    // The policy commit is acknowledged before the container batch, as in the workflow.
    for (const retiredContainers of [
      {
        containerIds: [crypto.randomUUID()],
        organizationId: ORGANIZATION_ID,
        policy: fixture.input.nextPolicy,
      },
      {
        containerIds: prepared.retiredContainerIds,
        organizationId: "wrong-organization",
        policy: fixture.input.nextPolicy,
      },
    ]) {
      await expect(
        retainLocallyAcknowledgedPrincipalPolicyBundles({
          entries: [
            { bundle: fixture.nextBundle, policy: fixture.input.nextPolicy },
          ],
          execSql: fixture.database.execSql,
          organizationId: ORGANIZATION_ID,
          retiredContainers,
          updatedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("Retirement must match");
      await verify();
    }
    await retainLocallyAcknowledgedPrincipalPolicyBundles({
      entries: [
        { bundle: fixture.nextBundle, policy: fixture.input.nextPolicy },
      ],
      execSql: fixture.database.execSql,
      organizationId: ORGANIZATION_ID,
      retiredContainers: {
        containerIds: prepared.retiredContainerIds,
        organizationId: ORGANIZATION_ID,
        policy: fixture.input.nextPolicy,
      },
      updatedAt: new Date().toISOString(),
    });
    await prepared.acknowledge(
      await Promise.all(
        prepared.requests.map((request) =>
          createMutationResponseFromRequest(
            request,
            second.containerKeks.at(-1),
          ),
        ),
      ),
    );
    // All signatures still verify. The API has contradicted the retirement on
    // which this device relied when acknowledging the group key rotation.
    await expect(verify()).rejects.toThrow("retired during principal rotation");
  } finally {
    fixture.database.close();
  }
});
