import { expect, test } from "bun:test";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  acknowledge,
  failure,
  runReplayedSeededCreate,
  runSeededContainerCreate,
} from "../../../../../test/helpers/workflows/seededContainerCreate";
import { CONTAINER_ALREADY_COMMITTED } from "./createWithMetadata";

test("an acknowledged container create reports its committed metadata seed", async () => {
  const { created, requests, seed } = await runSeededContainerCreate(
    "container-seed-acknowledged",
    acknowledge,
  );
  if (!created || typeof created === "symbol") {
    throw new Error("Expected a fresh container create");
  }
  expect(requests).toHaveLength(1);
  expect(
    requests[0]?.initialMetadataSync?.outgoingUpdates.map(
      (update) => update.id,
    ),
  ).toEqual([seed.id]);
  expect(created.metadataSeed).toEqual({
    commitLsn: "0/20",
    updateId: seed.id,
  });
});

test("a refused seeded container create falls back to the plain create once", async () => {
  const { created, requests } = await runSeededContainerCreate(
    "container-seed-refused",
    (request, attempt) =>
      attempt === 1 ? Promise.resolve(failure(402)) : acknowledge(request),
  );
  if (!created || typeof created === "symbol") {
    throw new Error("Expected a fresh container create");
  }
  expect(
    requests.map((request) => Boolean(request.initialMetadataSync)),
  ).toEqual([true, false]);
  expect(created.metadataSeed).toBeUndefined();
});

test("a lost seeded container create response is adopted without resubmitting", async () => {
  const { created, requests } = await runSeededContainerCreate(
    "container-seed-lost-response",
    () =>
      Promise.resolve(
        failure(409, CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists),
      ),
  );
  expect(created).toBe(CONTAINER_ALREADY_COMMITTED);
  expect(requests).toHaveLength(1);
});

test("a replayed container create settles its queued metadata seed", async () => {
  const result = await runReplayedSeededCreate(
    "container-seed-replay",
    acknowledge,
  );
  expect(result.created).toBe(1);
  expect(
    result.requests[0]?.initialMetadataSync?.outgoingUpdates.map(
      (update) => update.id,
    ),
  ).toEqual([result.seed.id]);
  expect(result.persisted).toEqual([
    {
      acceptedPendingUpdateIds: [result.seed.id],
      clearSyncFailure: true,
      lastCommitLsn: "0/20",
    },
  ]);
  // Registered before the create, so its own update echo stays self-authored.
  expect([...result.locallyAcceptedMetadataUpdateIds]).toEqual([
    result.seed.id,
  ]);
});

test("a replayed container create whose seed was refused drops its registration", async () => {
  const result = await runReplayedSeededCreate(
    "container-seed-replay-refused",
    (request, attempt) =>
      attempt === 1 ? Promise.resolve(failure(402)) : acknowledge(request),
  );
  expect(result.created).toBe(1);
  expect(
    result.requests.map((request) => Boolean(request.initialMetadataSync)),
  ).toEqual([true, false]);
  expect(result.persisted).toEqual([
    {
      acceptedPendingUpdateIds: undefined,
      clearSyncFailure: undefined,
      lastCommitLsn: null,
    },
  ]);
  expect([...result.locallyAcceptedMetadataUpdateIds]).toEqual([]);
});

test("a peer's metadata hint before the create response still queues a read", async () => {
  const observed: { echo?: string[]; peer?: string[]; planned?: string } = {};
  const result = await runReplayedSeededCreate(
    "container-seed-delayed-response",
    (request, _attempt, hint) => {
      const documentId = String(
        Reflect.get(request.metadataDocument.event, "objectId"),
      );
      const seedId = request.initialMetadataSync?.outgoingUpdates[0]?.id ?? "";
      observed.planned = documentId;
      // The seed's own echo is self-authored and queues nothing.
      observed.echo = hint(documentId, [seedId]);
      // A peer renames the committed folder before the response arrives,
      // while the folder's record has no metadata document id yet.
      observed.peer = hint(documentId, ["peer-rename"]);
      return acknowledge(request);
    },
  );
  expect(result.created).toBe(1);
  expect(result.persisted).toEqual([
    {
      acceptedPendingUpdateIds: [result.seed.id],
      clearSyncFailure: true,
      lastCommitLsn: "0/20",
    },
  ]);
  expect(observed.echo).toEqual([]);
  expect(observed.planned).toBeDefined();
  expect(observed.peer).toEqual([observed.planned ?? ""]);
  expect([...result.plannedMetadataDocumentIds]).toEqual([]);
});

test("a container create torn down while its seed encrypts submits nothing", async () => {
  const result = await runReplayedSeededCreate(
    "container-seed-teardown",
    acknowledge,
    true,
  );
  expect(result.requests).toEqual([]);
  expect(result.persisted).toEqual([]);
});

// Sync-edge-cases row 19. The billing gate learns of a block only from a 402,
// so the preflight passes and the refused create is itself the first signal.
test("a replayed create refused by the organization's first 402 stays pending with no error", async () => {
  const gateChecks: string[] = [];
  let paymentRequired = false;
  const result = await runReplayedSeededCreate(
    "container-create-billing-pause",
    () => {
      paymentRequired = true;
      return Promise.resolve(failure(402));
    },
    false,
    (organizationId) => {
      gateChecks.push(organizationId);
      return paymentRequired;
    },
  );
  expect(result.created).toBe(0);
  expect(result.requests).toHaveLength(2);
  expect(result.persisted).toEqual([]);
  expect(result.recordedErrors).toEqual([]);
  // Asked before the request and again after its refusal, for the same org.
  expect(gateChecks).toEqual([result.organizationId, result.organizationId]);
});

test("a replayed create refused while the organization can sync records the refusal", async () => {
  const result = await runReplayedSeededCreate("container-create-refused", () =>
    Promise.resolve(failure(402)),
  );
  expect(result.created).toBe(0);
  expect(result.recordedErrors).toEqual([
    "Remote container create was rejected or unavailable",
  ]);
});
