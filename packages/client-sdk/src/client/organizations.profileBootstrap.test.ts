import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationBillingResponse } from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../data/persistence/documents/documentsPersistence";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";
import { syncEntitledOrganizationProfile } from "./organizationProfileBootstrap";
import { createOrganizations } from "./organizations";
import type { InternalRuntime } from "./workflowRuntime";

const ORGANIZATION_ID = "org-additional";
const METADATA_CONTAINER_ID = "organization-metadata";
const PROFILE_LOCAL_ID = getOrganizationProfileDocumentLocalId({
  organizationId: ORGANIZATION_ID,
});

function billing(
  status: OrganizationBillingResponse["status"],
): OrganizationBillingResponse {
  return {
    organizationId: ORGANIZATION_ID,
    status,
    trialEndsAt: status === "trialing" ? "2099-01-01T00:00:00.000Z" : null,
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: status === "local" ? 0 : 1,
    disabledAt: null,
    purgeAfter: null,
  };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

type LocalProfileState = "missing" | "pending" | "settled";

async function createHarness(input?: {
  billing?: OrganizationBillingResponse;
  coldTree?: boolean;
  localProfile?: LocalProfileState;
  pullDocumentContent?: () => void;
  refresh?: () => Promise<void>;
}) {
  const database = await createTestExecSql(
    `organizations-profile-bootstrap-${crypto.randomUUID()}`,
  );
  const { execSql } = database;
  const localProfile = input?.localProfile ?? "pending";
  await sqlDocumentsPersistence.ensureSchema(execSql);
  if (localProfile !== "missing") {
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      containerId: METADATA_CONTAINER_ID,
      documentId: "organization-profile-document",
      documentKind: "organization_profile",
      id: PROFILE_LOCAL_ID,
      loroSnapshot: "profile-snapshot",
      text: "",
    });
  }
  if (localProfile === "pending") {
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: PROFILE_LOCAL_ID,
      partialEndVersionVector: "pending-end",
      partialStartVersionVector: "pending-start",
      sourceVersionVector: null,
      updateData: "pending-profile-update",
    });
  }

  let activeOrganizationId = ORGANIZATION_ID;
  let activeUserId = "user-1";
  let domainScope = {};
  let currentBilling = input?.billing ?? billing("local");
  const logs: string[] = [];
  const pulls: Array<{ containerId: string; localId: string }> = [];
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const nodes = [{ id: METADATA_CONTAINER_ID, systemSlot: metadataSlot }];
  let visibleNodes = input?.coldTree ? [] : nodes;
  const containerContents = {
    openTree: () => ({
      getSnapshot: () => ({ nodes: visibleNodes }),
      refresh: async () => {
        await input?.refresh?.();
        visibleNodes = nodes;
        return true;
      },
    }),
    pullDocumentContent: (pullInput: {
      containerId: string;
      localId: string;
    }) => {
      pulls.push(pullInput);
      input?.pullDocumentContent?.();
    },
  } as unknown as ContainerContents;
  const runtime = {
    workflowInput: () => ({
      apiClient: {
        getOrganizationBilling: async () => currentBilling,
        startOrganizationTrial: async () => currentBilling,
      },
      auth: {
        isAuthenticated: true,
        organizationId: activeOrganizationId,
        userId: activeUserId,
      },
      infra: { dbStatus: "ready", execSql },
      state: { domainScope },
      util: {
        log: (message: string) => logs.push(message),
        logError: () => undefined,
      },
    }),
  } as unknown as InternalRuntime;

  return {
    close: database.close,
    containerContents,
    captureRuntimeContextGuard: () => {
      const expected = {
        domainScope,
        organizationId: activeOrganizationId,
        userId: activeUserId,
      };
      return () =>
        activeOrganizationId === expected.organizationId &&
        activeUserId === expected.userId &&
        domainScope === expected.domainScope;
    },
    execSql,
    logs,
    organizations: createOrganizations(runtime, containerContents),
    pulls,
    setActiveOrganizationId: (organizationId: string) => {
      activeOrganizationId = organizationId;
    },
    setBilling: (next: OrganizationBillingResponse) => {
      currentBilling = next;
    },
    setRuntimeIdentity: (input: { domainScope: object; userId: string }) => {
      activeUserId = input.userId;
      domainScope = input.domainScope;
    },
  };
}

test("local billing never uploads a pending seeded profile", async () => {
  const harness = await createHarness();
  try {
    expect(await harness.organizations.loadBilling()).toEqual(billing("local"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.pulls).toEqual([]);
  } finally {
    harness.close();
  }
});

test("an initial syncable snapshot uploads a persisted pending profile", async () => {
  const harness = await createHarness({ billing: billing("trialing") });
  try {
    await harness.organizations.loadBilling();
    await waitFor(
      () => harness.pulls.length === 1,
      "Expected pending profile sync after reload",
    );
    expect(harness.pulls).toEqual([
      { containerId: METADATA_CONTAINER_ID, localId: PROFILE_LOCAL_ID },
    ]);
  } finally {
    harness.close();
  }
});

test.each([
  "settled",
  "missing",
] as const)("an initial syncable snapshot does not upload a %s local profile", async (localProfile) => {
  const harness = await createHarness({
    billing: billing("trialing"),
    localProfile,
  });
  try {
    await harness.organizations.loadBilling();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.pulls).toEqual([]);
  } finally {
    harness.close();
  }
});

test("a purchase or restore refresh uploads a pending profile", async () => {
  const harness = await createHarness();
  try {
    await harness.organizations.loadBilling();
    harness.setBilling(billing("trialing"));
    await harness.organizations.loadBilling();
    await waitFor(
      () => harness.pulls.length === 1,
      "Expected profile sync after syncable billing refresh",
    );
  } finally {
    harness.close();
  }
});

test("one pending update set is requested once and clearing keeps it settled", async () => {
  const harness = await createHarness({ billing: billing("trialing") });
  try {
    await harness.organizations.loadBilling();
    await waitFor(
      () => harness.pulls.length === 1,
      "Expected initial profile sync request",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The document lane owns retries after the first request, even before it
    // clears the durable pending row.
    await harness.organizations.loadBilling();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.pulls).toHaveLength(1);

    await sqlDocumentsPersistence.deletePendingUpdates(
      harness.execSql,
      PROFILE_LOCAL_ID,
    );

    await harness.organizations.loadBilling();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.pulls).toHaveLength(1);
  } finally {
    harness.close();
  }
});

test("trial activation success survives profile scheduling failure", async () => {
  const harness = await createHarness({
    billing: billing("trialing"),
    pullDocumentContent: () => {
      throw new Error("planned profile scheduling failure");
    },
  });
  try {
    await expect(harness.organizations.startTrial()).resolves.toEqual(
      billing("trialing"),
    );
    await waitFor(
      () => harness.logs.some((message) => message.includes("planned profile")),
      "Expected best-effort scheduling failure to be logged",
    );
    expect(harness.pulls).toHaveLength(1);
  } finally {
    harness.close();
  }
});

test("an organization switch during bootstrap prevents wrong-scope scheduling", async () => {
  let releaseRefresh: (() => void) | undefined;
  const refreshStarted = Promise.withResolvers<void>();
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const harness = await createHarness({
    billing: billing("trialing"),
    coldTree: true,
    refresh: async () => {
      refreshStarted.resolve();
      await refreshReleased;
    },
  });
  try {
    const syncPromise = syncEntitledOrganizationProfile({
      billing: billing("trialing"),
      containerContents: harness.containerContents,
      execSql: harness.execSql,
      isRuntimeContextCurrent: harness.captureRuntimeContextGuard(),
      log: () => undefined,
    });
    await refreshStarted.promise;
    harness.setActiveOrganizationId("org-other");
    releaseRefresh?.();

    await expect(syncPromise).resolves.toBe(false);
    expect(harness.pulls).toEqual([]);
  } finally {
    releaseRefresh?.();
    harness.close();
  }
});

test("a same-org identity switch during bootstrap prevents scheduling", async () => {
  let releaseRefresh: (() => void) | undefined;
  const refreshStarted = Promise.withResolvers<void>();
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const harness = await createHarness({
    billing: billing("trialing"),
    coldTree: true,
    refresh: async () => {
      refreshStarted.resolve();
      await refreshReleased;
    },
  });
  try {
    const syncPromise = syncEntitledOrganizationProfile({
      billing: billing("trialing"),
      containerContents: harness.containerContents,
      execSql: harness.execSql,
      isRuntimeContextCurrent: harness.captureRuntimeContextGuard(),
      log: () => undefined,
    });
    await refreshStarted.promise;
    harness.setRuntimeIdentity({ domainScope: {}, userId: "user-2" });
    releaseRefresh?.();

    await expect(syncPromise).resolves.toBe(false);
    expect(harness.pulls).toEqual([]);
  } finally {
    releaseRefresh?.();
    harness.close();
  }
});
