import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { DOCUMENT_PROJECTION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../test/helpers/authenticate";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { getWriterProjection } from "../../test/helpers/staleBundleHealKit";

// The document writer-projection route deliberately remaps container-level
// 404s and serves keying conflicts as 409s (a document-route 404 triggers a
// destructive client wipe). Those used to be code-less, so a client could not
// report WHICH dependency refused — a persistently 409ing document was
// undiagnosable from a System Monitor report. The 409 classes now carry
// stable codes.

test("a container keying conflict surfaces as a coded 409", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Corrupt the container KEK state: point the epoch row at a different
  // container so loadContainerKekState rejects it as stale.
  await db
    .update(containerKeyEpochs)
    .set({ containerId: crypto.randomUUID() })
    .where(eq(containerKeyEpochs.id, root.kekState.containerKeyEpochId));

  const { response, projection } = await getWriterProjection(owner, created.id);
  expect(response.status).toBe(409);
  // The corrupted epoch is caught by whichever dependency reads it first
  // (the KEK-targets resolver today); the contract is that every 409 this
  // route emits carries one of the stable projection codes.
  const code =
    projection && typeof projection === "object" && "code" in projection
      ? projection.code
      : undefined;
  expect(
    (Object.values(DOCUMENT_PROJECTION_ERROR_CODES) as string[]).includes(
      typeof code === "string" ? code : "",
    ),
  ).toBe(true);
}, 15_000);

test("a denied projection stays a plain 403 without a projection code", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const outsider = createTestUser();
  await registerUser(outsider);
  await authenticate(outsider);

  const { response, projection } = await getWriterProjection(
    outsider,
    created.id,
  );
  expect(response.status).toBe(403);
  expect(
    projection && typeof projection === "object" && "code" in projection
      ? projection.code
      : undefined,
  ).toBeUndefined();
}, 15_000);
