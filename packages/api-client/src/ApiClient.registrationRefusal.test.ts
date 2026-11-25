import { expect } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import { LEGAL_TERMS_OUTDATED_ERROR_CODE } from "@tearleads/validators/legalTerms";
import { registerOperation } from "@tearleads/validators/operation";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { createRegistrationRequestFixture } from "../test/helpers/provisioningFixtures";
import { ApiClient } from "./ApiClient";

testApiClient(
  "a refused legal terms revision is recorded with its code under the registration request",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/auth/register`, () =>
        HttpResponse.json(
          { code: LEGAL_TERMS_OUTDATED_ERROR_CODE, error: "terms changed" },
          { status: 409, statusText: "Conflict" },
        ),
      ),
    );
    const registration = createRegistrationRequestFixture();
    const client = new ApiClient(apiBaseUrl);
    client.setOnError(() => undefined);

    await expect(
      client.registerUser(
        registration.userId,
        registration.organizationId,
        registration.rootContainerId,
        base64ToBytes(registration.signingPublicKey),
        base64ToBytes(registration.encapsulationPublicKey),
        registration.initialAdminGroup,
        registration.initialMemberGroup,
        registration.initialOrganizationPolicy,
        registration.initialRootContainer,
        registration.initialRootMetadataDocument,
        registration.initialRosterProfileContainer,
        registration.initialRosterProfileDocument,
        registration.initialOrganizationMetadataContainer,
        registration.initialOrganizationProfileDocument,
        registration.initialSystemContainers,
        "2000-01-01",
      ),
    ).resolves.toBeNull();

    // The SDK reads it back by the operation's own method and path.
    expect(
      client.getRequestFailure({
        method: registerOperation.method,
        path: registerOperation.path,
      }),
    ).toMatchObject({
      code: LEGAL_TERMS_OUTDATED_ERROR_CODE,
      kind: "http",
      status: 409,
    });
  },
);
