import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  ORGANIZATION_PRESENTATION_ERROR_CODES,
  type OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import {
  organizationReadModelFailure,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/data/organizationReadModelProjectionFixtures";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { OrganizationReadModelRepository } from "../../data/persistence/organizations/organizationReadModelRepository";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;

/**
 * A coordinator over a projection at `cursor-1` whose first feed request
 * waits until released, then answers `answer`; later requests answer `next`
 * at once. `relogin` logs the same identity out and back in, which keeps the
 * domain scope and the database; `renew` renews the session's token.
 */
async function delayedFeedFixture(
  name: string,
  answer: RequestResult<OrganizationReadModelResponse>,
  next: RequestResult<OrganizationReadModelResponse> = answer,
) {
  const { close, execSql } = await createTestExecSql(name);
  const repository = new OrganizationReadModelRepository(execSql);
  await repository.applyOrganizationReadModelResponse({
    currentUserId: userId,
    requestedCursor: null,
    response: organizationReadModelSnapshot({ cursor: "cursor-1" }),
  });
  let markRequested = () => {};
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let releaseFeed = () => {};
  const released = new Promise<void>((resolve) => {
    releaseFeed = resolve;
  });
  let requests = 0;
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult() {
      requests += 1;
      if (requests > 1) return next;
      markRequested();
      await released;
      return answer;
    },
  });
  const workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId, userId },
    execSql,
  });
  let sessionGeneration = 0;
  let scopeGeneration = 0;
  const coordinator = createOrganizationReadModelCoordinator({
    ...createInternalRuntimeFixture(() => workflowInput),
    get scopeGeneration() {
      return scopeGeneration;
    },
    get sessionGeneration() {
      return sessionGeneration;
    },
  });
  return {
    close,
    coordinator,
    relogin: () => {
      sessionGeneration += 1;
      scopeGeneration += 1;
    },
    releaseFeed,
    renew: () => {
      sessionGeneration += 1;
    },
    repository,
    requested,
    requests: () => requests,
  };
}

test("a denial answered after a relogin leaves the new session's projection", async () => {
  const f = await delayedFeedFixture(
    "read-model-denial-relogin-test",
    organizationReadModelFailure({
      code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
      kind: "http",
      status: 403,
    }),
  );
  try {
    const reconciled = f.coordinator.reconcile();
    await f.requested;
    f.relogin();
    f.releaseFeed();

    await expect(reconciled).resolves.toBeNull();
    // The old session's 403 neither denied, marked nor purged the new one's.
    await expect(f.coordinator.loadLocal()).resolves.toMatchObject({
      readModelCursor: "cursor-1",
    });
    await expect(
      f.repository.hasOrganizationPresentationDenial(
        { organizationId, requesterUserId: userId },
        "readModel",
      ),
    ).resolves.toBe(false);
  } finally {
    f.close();
  }
});

test("a page answered after a relogin is not applied", async () => {
  const f = await delayedFeedFixture("read-model-page-relogin-test", {
    data: organizationReadModelGroupsDelta({
      cursor: "cursor-2",
      groupName: "Operators",
    }),
    ok: true,
  });
  try {
    const reconciled = f.coordinator.reconcile();
    await f.requested;
    f.relogin();
    f.releaseFeed();

    await expect(reconciled).resolves.toBeNull();
    await expect(
      f.repository.loadOrganizationReadModelProjection(organizationId, userId),
    ).resolves.toMatchObject({ cursor: "cursor-1" });
  } finally {
    f.close();
  }
});

const denied = organizationReadModelFailure({
  code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
  kind: "http",
  status: 403,
});

function page(cursor: string): RequestResult<OrganizationReadModelResponse> {
  return {
    data: organizationReadModelGroupsDelta({ cursor, groupName: "Operators" }),
    ok: true,
  };
}

test("a page replayed after a token renewal still applies", async () => {
  const f = await delayedFeedFixture(
    "read-model-page-renewal-test",
    page("cursor-2"),
  );
  try {
    const reconciled = f.coordinator.reconcile();
    await f.requested;
    f.renew();
    f.releaseFeed();

    await expect(reconciled).resolves.toMatchObject({
      readModelCursor: "cursor-2",
    });
  } finally {
    f.close();
  }
});

test("a denial replayed after a token renewal still denies and purges", async () => {
  const f = await delayedFeedFixture("read-model-denial-renewal-test", denied);
  try {
    const reconciled = f.coordinator.reconcile();
    await f.requested;
    f.renew();
    f.releaseFeed();

    await expect(reconciled).resolves.toBeNull();
    await expect(f.coordinator.loadLocal()).resolves.toBeNull();
    await expect(
      f.repository.hasOrganizationPresentationDenial(
        { organizationId, requesterUserId: userId },
        "readModel",
      ),
    ).resolves.toBe(true);
  } finally {
    f.close();
  }
});

test("a relogin starts its own pass while the old one is pending", async () => {
  const f = await delayedFeedFixture(
    "read-model-relogin-own-pass-test",
    denied,
    page("cursor-2"),
  );
  try {
    const stale = f.coordinator.reconcile();
    await f.requested;
    f.relogin();
    const fresh = f.coordinator.reconcile();

    expect(fresh).not.toBe(stale);
    await expect(fresh).resolves.toMatchObject({ readModelCursor: "cursor-2" });
    f.releaseFeed();
    await expect(stale).resolves.toBeNull();
    expect(f.requests()).toBe(2);
    // The stale pass neither purged nor unpublished the fresh one's cursor.
    await expect(f.coordinator.loadAppliedCursor()).resolves.toBe("cursor-2");
  } finally {
    f.close();
  }
});
