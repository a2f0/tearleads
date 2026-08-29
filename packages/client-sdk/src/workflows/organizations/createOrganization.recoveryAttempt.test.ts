import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { createOrganization } from "./createOrganization";

function requireRequest(
  request: CreateOrganizationRequest | null,
): CreateOrganizationRequest {
  if (!request) throw new Error("Expected a provisioning request");
  return request;
}

test("replacement provisioning replays exact artifacts after a lost response", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-replacement-lost-response-test",
  );
  const dbClient = execSqlClientFromExecSql(execSql);
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const replacesOrganizationId = crypto.randomUUID();
  let firstRequest: CreateOrganizationRequest | null = null;
  let retriedRequest: CreateOrganizationRequest | null = null;

  try {
    await expect(
      createOrganization({
        apiClient: {
          createOrganization: async (request) => {
            firstRequest = request;
            await respondToOrganizationProvisioning(request);
            throw new Error("response lost after server commit");
          },
        },
        dbClient,
        encapsulationKeyPair,
        replacesOrganizationId,
        signingKeyPair,
        userId,
      }),
    ).rejects.toThrow("response lost after server commit");

    const response = await createOrganization({
      apiClient: {
        createOrganization: async (request) => {
          retriedRequest = request;
          return respondToOrganizationProvisioning(request);
        },
      },
      dbClient,
      encapsulationKeyPair,
      replacesOrganizationId,
      signingKeyPair,
      userId,
    });

    const durableRequest = requireRequest(firstRequest);
    expect(requireRequest(retriedRequest)).toEqual(durableRequest);
    expect(response).toEqual(
      expect.objectContaining({
        organizationId: durableRequest.organizationId,
        rootContainerId: durableRequest.rootContainerId,
      }),
    );
  } finally {
    close();
  }
});
