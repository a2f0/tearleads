import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containers,
  organizationReadModelHeads,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const concurrencyTimeoutMs = 30_000;

function postCreate(input: {
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request("/containers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.request),
    }),
  );
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a concurrent duplicate container create returns the adoption code",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const request = await buildChildCreateRequest({ root, signer: owner });
    const organizationId = asVerifiedContainerManifest(root.bundle).state
      .organizationId;

    const organizationLock = await holdPostgresLock(async (tx) => {
      await tx
        .select({ organizationId: organizationReadModelHeads.organizationId })
        .from(organizationReadModelHeads)
        .where(eq(organizationReadModelHeads.organizationId, organizationId))
        .for("update");
    });
    const contenders: Promise<Response>[] = [];
    let synchronizationError: unknown;
    try {
      contenders.push(postCreate({ request, token: owner.token }));
      await waitForPostgresLockWait({
        blockerPid: organizationLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
      contenders.push(postCreate({ request, token: owner.token }));
      await waitForPostgresLockWait({
        blockerPid: organizationLock.backendPid,
        queryFragment: "containers",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await organizationLock.release();
    }
    const responses = await Promise.all(contenders);
    if (synchronizationError) {
      throw synchronizationError;
    }

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const loser = responses.find((response) => response.status === 409);
    expect(await loser?.json()).toEqual({
      code: CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
      error: "Container manifest already exists",
    });

    const { objectId } = request.event as { readonly objectId: unknown };
    const containerId = String(objectId);
    expect(
      await db
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.id, containerId)),
    ).toEqual([{ id: containerId }]);
  },
  concurrencyTimeoutMs,
);
