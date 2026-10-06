import { beforeAll, expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createProjectionCheckpointContext } from "../../data/keyingProjectionVerification/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test("a verification predecessor failure retains its security classification", async () => {
  const f = await fixture();
  try {
    const error = new KeyingVerificationError(
      "stale_predecessor",
      "Signed chain is disconnected",
    );
    f.transport.getPrincipalPolicyPages = () => {
      throw error;
    };
    await expect(f.collect()).rejects.toBe(error);
    expect(f.incidents).toEqual([error]);
    expect(f.state.fullReads).toBe(0);
  } finally {
    f.close();
  }
});

async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  const state = { online: true, fullReads: 0 };
  const incidents: unknown[] = [];
  const pages = source.options.apiClient.getPrincipalPolicyPages.bind(
    source.options.apiClient,
  );
  const transport: Pick<ApiClient, "getPrincipalPolicyPages"> = {
    getPrincipalPolicyPages: pages,
  };
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getPrincipalPolicyPages: (...args) =>
        transport.getPrincipalPolicyPages(...args),
      getCurrentPrincipalPolicy: async (_kind, id) => {
        state.fullReads += 1;
        return source.policies.get(id) ?? null;
      },
    },
    infra: { execSql: source.options.execSql },
    state,
    withPrincipalHistoryProtection: (operation) =>
      operation({
        protection: source.options.protection,
        stillCurrent: () => true,
      }),
    resolveTrustedUserIdentity: source.options.resolveTrustedUserIdentity,
    util: {
      log: () => undefined,
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
  });
  const collect = (reference = principalPolicyHead(history.created)) =>
    collectReferencedPrincipalPolicies({
      checkpointContext: createProjectionCheckpointContext(source.options),
      organizationId: history.organizationId,
      principalPolicyCache: new Map(),
      references: [reference],
      resolveUserKey: source.options.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies: warmer,
    });
  const savePin = async (bundle: typeof history.directory) => {
    const head = bundle.currentState;
    await source.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: head.principalType,
        principalId: head.principalId,
        version: head.version,
        stateHash: head.stateHash,
        updatedAt: head.createdAt,
      })
      .run();
  };
  return { ...source, state, incidents, pages, transport, collect, savePin };
}

test.each(["discovery", "pinned"] as const)(
  "an incomplete online %s read is unavailable without an incident or full-history fetch",
  async (phase) => {
    const f = await fixture();
    try {
      f.transport.getPrincipalPolicyPages = async function* (
        kind,
        id,
        options,
      ) {
        if (phase === "discovery" || options?.stateHash) return;
        yield* f.pages(kind, id, options);
      };
      await expect(f.collect()).rejects.toMatchObject({
        name: "ProjectionDependencyUnavailableError",
      });
      expect(f.incidents).toEqual([]);
      expect(f.state.fullReads).toBe(0);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test("a directory still behind a new citation is unavailable after one refresh", async () => {
  const f = await fixture();
  try {
    const next = await history.extend(history.group, 67);
    f.policies.set(next.currentState.principalId, next);
    await expect(f.collect(principalPolicyHead(next))).rejects.toMatchObject({
      name: "ProjectionDependencyUnavailableError",
    });
    expect(
      f.requests.filter(
        (request) =>
          request.principalId === history.organizationId &&
          request.afterVersion === 0,
      ),
    ).toHaveLength(3);
    expect(f.incidents).toEqual([]);
    expect(f.state.fullReads).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("a local pin advancing during a verified read is unavailable without an incident", async () => {
  const f = await fixture();
  try {
    const next = await history.advanceDirectory(
      history.directory,
      history.group,
    );
    let advanced = false;
    f.transport.getPrincipalPolicyPages = async function* (kind, id, options) {
      for await (const result of f.pages(kind, id, options)) {
        if (
          !advanced &&
          options?.stateHash &&
          result.ok &&
          result.data.historyPage.nextAfterVersion === null
        ) {
          advanced = true;
          await f.savePin(next);
        }
        yield result;
      }
    };
    await expect(f.collect()).rejects.toMatchObject({
      name: "ProjectionDependencyUnavailableError",
    });
    expect(advanced).toBe(true);
    expect(f.incidents).toEqual([]);
    expect(f.state.fullReads).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toHaveLength(
      1,
    );
  } finally {
    f.close();
  }
});

test.each([false, true])(
  "an older completed prefix with offline=%s keeps the durable pin and correct incident classification",
  async (offline) => {
    const f = await fixture();
    try {
      await f.collect();
      await f.savePin(
        await history.advanceDirectory(history.directory, history.group),
      );
      f.state.online = !offline;
      const count = f.requests.length;
      await expect(f.collect()).rejects.toMatchObject(
        offline
          ? { name: "ProjectionDependencyUnavailableError" }
          : { code: "rollback" },
      );
      expect(f.incidents).toHaveLength(offline ? 0 : 1);
      if (offline) expect(f.requests).toHaveLength(count);
      expect(f.state.fullReads).toBe(0);
      expect(
        (await f.db.select().from(principalPolicyCheckpoints))[0]?.version,
      ).toBe(67);
    } finally {
      f.close();
    }
  },
);

test.each([403, 409])(
  "a paged %s refusal does not fetch an available full bundle",
  async (status) => {
    const f = await fixture();
    try {
      f.controls.failureStatus = status;
      await expect(f.collect()).rejects.toMatchObject({
        name: "ProjectionDependencyUnavailableError",
      });
      expect(f.state.fullReads).toBe(0);
      expect(f.incidents).toEqual([]);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
);
