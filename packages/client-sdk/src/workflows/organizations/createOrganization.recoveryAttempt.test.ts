import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
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

test("two devices adopt the same winning replacement organization", async () => {
  const left = await createTestExecSql("organization-replacement-left-device");
  const right = await createTestExecSql(
    "organization-replacement-right-device",
  );
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const replacesOrganizationId = crypto.randomUUID();
  const requests: CreateOrganizationRequest[] = [];
  let winningResponse: Awaited<
    ReturnType<typeof respondToOrganizationProvisioning>
  > | null = null;
  const apiClient = {
    createOrganization: async (request: CreateOrganizationRequest) => {
      requests.push(request);
      winningResponse ??= await respondToOrganizationProvisioning(request);
      return winningResponse;
    },
  };

  try {
    const leftResponse = await createOrganization({
      apiClient,
      dbClient: execSqlClientFromExecSql(left.execSql),
      encapsulationKeyPair,
      replacesOrganizationId,
      signingKeyPair,
      userId,
    });
    const rightResponse = await createOrganization({
      apiClient,
      dbClient: execSqlClientFromExecSql(right.execSql),
      encapsulationKeyPair,
      replacesOrganizationId,
      signingKeyPair,
      userId,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.organizationId).not.toBe(requests[0]?.organizationId);
    expect(rightResponse).toEqual(leftResponse);
    const winnerRootId = leftResponse?.rootContainerId;
    const losingRootId = requests[1]?.rootContainerId;
    if (!winnerRootId || !losingRootId) {
      throw new Error("Expected both replacement candidates");
    }
    await expect(
      sqlContainerContentsPersistence.containerExists(
        left.execSql,
        winnerRootId,
      ),
    ).resolves.toBe(true);
    await expect(
      sqlContainerContentsPersistence.containerExists(
        right.execSql,
        losingRootId,
      ),
    ).resolves.toBe(false);
  } finally {
    left.close();
    right.close();
  }
});
