import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";

// A founding policy has no predecessor to rebuild against (#2903 P17).
test("POST /organizations refuses envelope changes on a founding policy", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const body = await createOrganizationRequestBody(user);
  const response = await submitCreateOrganization(user, {
    ...body,
    initialOrganizationPolicy: {
      ...body.initialOrganizationPolicy,
      memberEnvelopeChanges: { removeUserIds: [], upsert: [] },
    },
  });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "has no predecessor to send member envelope changes against",
  );
});
