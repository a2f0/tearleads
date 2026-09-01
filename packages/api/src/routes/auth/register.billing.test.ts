import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
} from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { isRegistrationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { submitRegistration } from "../../../test/helpers/api";

test("POST /auth/register starts the personal organization on a sync trial", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const startedAt = Date.now();

  const res = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  invariant(isRegistrationResponse(body), "expected register response");

  const [billing] = await db
    .select({
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
      trialEndsAt: organizationBilling.trialEndsAt,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, body.organizationId));

  invariant(billing, "expected personal organization billing row");
  expect(billing.status).toBe("trialing");
  expect(billing.seatCount).toBe(10);
  invariant(billing.trialEndsAt, "expected trialEndsAt to be set");
  expect(billing.trialEndsAt.getTime()).toBeGreaterThan(startedAt);

  const [initialized] = await db
    .select()
    .from(organizationBillingLifecycleEvents)
    .where(
      eq(
        organizationBillingLifecycleEvents.organizationId,
        body.organizationId,
      ),
    );
  invariant(initialized, "expected free-trial lifecycle event");
  expect(initialized).toMatchObject({
    activeSeatCount: 1,
    eventType: "free_trial_initialized",
    licensedSeatCount: 10,
    quantityDelta: 10,
  });
  expect(initialized.periodEndsAt).toEqual(billing.trialEndsAt);
  expect(initialized.periodStartsAt.getTime()).toBeGreaterThanOrEqual(
    startedAt,
  );
});
