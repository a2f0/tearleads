import { expect, test } from "bun:test";
import type { RequestFailure, RequestResult } from "@tearleads/api-client";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import {
  createPrincipalReciteFixture,
  ROOT_CONTAINER_ID,
  SECOND_CONTAINER_ID,
} from "../../../test/helpers/principalReciteFixtures";
import { buildPrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";
import { loadRematerializationTargets } from "./principalContainerRematerializationTargets";

test("a deleted signed grant does not block rotation of the remaining live grant", async () => {
  const fixture = await createPrincipalReciteFixture({
    databaseName: "deleted-group-grant",
    rotateKey: true,
    containerIds: [ROOT_CONTAINER_ID, SECOND_CONTAINER_ID],
  });
  try {
    const api = fixture.input.apiClient;
    const getProjection = (id: string) =>
      id === ROOT_CONTAINER_ID
        ? Promise.resolve(null)
        : api.getContainerWriterProjection(id);
    const requests = await buildPrincipalContainerRematerializationBatch({
      ...fixture.input,
      apiClient: {
        ...api,
        getContainerWriterProjection: getProjection,
        getContainerWriterProjectionResult: async (
          id: string,
        ): Promise<RequestResult<ContainerWriterProjectionResponse>> => {
          const data = await getProjection(id);
          return data
            ? { ok: true, data }
            : {
                ok: false,
                kind: "http",
                status: 404,
                code: CONTAINER_NOT_FOUND_ERROR_CODE,
                message: "Container not found",
                method: "GET",
                path: `/containers/${id}/writer-projection`,
                report: () => {},
                statusText: "Not Found",
              };
        },
      },
    });
    expect(requests.map((request) => request.event)).toEqual([
      expect.objectContaining({
        objectId: SECOND_CONTAINER_ID,
        eventType: "container.rekey",
      }),
    ]);
    expect(
      fixture.input.nextPolicy.grants.some(
        (grant) => grant.containerId === ROOT_CONTAINER_ID,
      ),
    ).toBe(true);
  } finally {
    fixture.database.close();
  }
});

test.each([
  { kind: "http", status: 403, code: CONTAINER_NOT_FOUND_ERROR_CODE },
  { kind: "http", status: 404, code: undefined },
  { kind: "network", status: 404, code: CONTAINER_NOT_FOUND_ERROR_CODE },
  { kind: "shape", status: 200, code: undefined },
] as const)(
  "an inconclusive projection failure cannot omit a grant: %o",
  async (failure) => {
    const result: RequestFailure = {
      ok: false,
      message: "unavailable",
      method: "GET",
      path: "/projection",
      report: () => {},
      statusText: "Unavailable",
      ...failure,
    };
    await expect(
      loadRematerializationTargets({
        apiClient: { getContainerWriterProjectionResult: async () => result },
        carriedContainerIds: [],
        grants: [{ containerId: ROOT_CONTAINER_ID, accessLevel: "admin" }],
      }),
    ).rejects.toThrow("could not be prepared");
  },
);

test("a missing carried ancestor cannot be skipped as a deleted grant", async () => {
  await expect(
    loadRematerializationTargets({
      apiClient: {
        getContainerWriterProjectionResult: async () => ({
          ok: false,
          kind: "http",
          status: 404,
          code: CONTAINER_NOT_FOUND_ERROR_CODE,
          message: "gone",
          method: "GET",
          path: "/projection",
          report: () => {},
          statusText: "Not Found",
        }),
      },
      carriedContainerIds: [ROOT_CONTAINER_ID],
      grants: [],
    }),
  ).rejects.toThrow("could not be prepared");
});
