import { expect, spyOn, test } from "bun:test";
import type { RequestFailure, RequestResult } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import { respondToOrganizationProvisioning } from "../../../../test/helpers/organizationProvisioningResponder";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
  type SqlArrayRow,
  type SqlRow,
} from "../../../data/sqlite/sqlSchema";
import { createOrganization } from "./createOrganization";
import { transitionOrganizationCreation } from "./organizationCreationState";

function refusal(overrides: Partial<RequestFailure> = {}): RequestFailure {
  return {
    ok: false,
    kind: "http",
    status: 410,
    code: "organization_creation_purged",
    message: "Purged",
    method: "POST",
    path: "/organizations",
    statusText: "Gone",
    report: () => {},
    ...overrides,
  };
}

async function harness() {
  const dbName = `/${crypto.randomUUID()}.db`;
  const creator = {
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
    userId: crypto.randomUUID(),
  };
  const requests: CreateOrganizationRequest[] = [];
  let result: (
    request: CreateOrganizationRequest,
  ) => Promise<RequestResult<CreateOrganizationResponse>> = async () =>
    refusal({ kind: "network", status: null, code: undefined });
  let current = true;
  let beforeDelete = () => {};
  async function open() {
    const db = await initTestSqliteDatabase({
      dbName,
      cipher: "chacha20",
      key: "terminal-attempt",
    });
    const dbClient: ExecSqlClientLike = {
      exec: async (options) => {
        if (
          options.sql.startsWith(
            'delete from "organization_provisioning_attempts"',
          )
        )
          beforeDelete();
        return {
          rows: execDatabaseStatement(db, options) as Array<
            SqlRow | SqlArrayRow
          >,
        };
      },
    };
    return {
      close: () => db.close(),
      dbClient,
      execSql: createExecSql(dbClient),
    };
  }
  let connection = await open();
  return {
    requests,
    get execSql() {
      return connection.execSql;
    },
    setResult: (next: typeof result) => {
      result = next;
    },
    setCurrent: (next: boolean) => {
      current = next;
    },
    setBeforeDelete: (next: typeof beforeDelete) => {
      beforeDelete = next;
    },
    attempts: () =>
      connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    create: () =>
      createOrganization({
        identityTrustDomain: "https://api.example.test",
        ...creator,
        dbClient: connection.dbClient,
        isIdentityCurrent: () => current,
        apiClient: {
          createOrganization: async () => {
            throw new Error("typed result must be used");
          },
          createOrganizationResult: async (request) => {
            requests.push(request);
            return result(request);
          },
        },
      }),
    reopen: async () => {
      connection.close();
      connection = await open();
    },
    close: () => connection.close(),
  };
}

test("terminal refusal is durable across SQLite reopen and failed release rolls back", async () => {
  const h = await harness();
  try {
    expect(await h.create()).toBeNull();
    const first = h.requests[0];
    if (!first) throw new Error("expected attempt");
    await h.reopen();
    expect(await h.attempts()).toEqual([
      { organization_id: first.organizationId },
    ]);
    h.setResult(async () => refusal());
    h.setBeforeDelete(() => {
      throw new Error("release failed");
    });
    await expect(h.create()).rejects.toThrow(
      'delete from "organization_provisioning_attempts"',
    );
    await h.reopen();
    expect(await h.attempts()).toEqual([
      { organization_id: first.organizationId },
    ]);
    h.setBeforeDelete(() => {});
    expect(await h.create()).toBeNull();
    expect(h.requests).toEqual([first, first, first]);
    expect(await h.attempts()).toEqual([]);
    await h.reopen();
    expect(await h.attempts()).toEqual([]);
    h.setResult(async (request) => ({
      ok: true,
      data: await respondToOrganizationProvisioning(request),
    }));
    const next = await h.create();
    expect(next?.organizationId).not.toBe(first.organizationId);
    expect(next).not.toBeNull();
    expect(h.requests).toHaveLength(4);
  } finally {
    h.close();
  }
});

for (const [label, failure] of [
  ["400", refusal({ status: 400 })],
  ["409", refusal({ status: 409 })],
  ["503", refusal({ status: 503 })],
  ["missing code", refusal({ code: undefined })],
  ["unknown code", refusal({ code: "unknown" })],
  ...(
    [
      "network",
      "json",
      "shape",
      "cancelled",
      "outcome-unknown",
      "storage",
    ] as const
  ).map((kind) => [kind, refusal({ kind })] as const),
  ["thrown", null],
] as const) {
  test(`ambiguous ${label} failure retains exact artifacts through SQLite reopen`, async () => {
    const h = await harness();
    try {
      await h.create();
      const first = h.requests[0];
      if (!first) throw new Error("expected attempt");
      h.setResult(async () => {
        if (!failure) throw new Error("network threw");
        return failure;
      });
      if (failure) expect(await h.create()).toBeNull();
      else await expect(h.create()).rejects.toThrow("network threw");
      await h.reopen();
      expect(await h.attempts()).toEqual([
        { organization_id: first.organizationId },
      ]);
      h.setResult(async (request) => ({
        ok: true,
        data: await respondToOrganizationProvisioning(request),
      }));
      expect((await h.create())?.organizationId).toBe(first.organizationId);
      expect(h.requests).toEqual([first, first, first]);
      expect(await h.attempts()).toEqual([]);
    } finally {
      h.close();
    }
  });
}

for (const phase of ["response", "queued", "delete"] as const) {
  test(`terminal release preserves the attempt if identity changes at ${phase}`, async () => {
    const h = await harness();
    const entered = Promise.withResolvers<void>();
    const respond =
      Promise.withResolvers<RequestResult<CreateOrganizationResponse>>();
    const unlock = Promise.withResolvers<void>();
    let blocker: Promise<void> | undefined;
    const queued = Promise.withResolvers<void>();
    const runtime = getClientSQLitePersistenceRuntime(h.execSql);
    const guarded = runtime.guardedTransaction.bind(runtime);
    const guardSpy = spyOn(runtime, "guardedTransaction").mockImplementation(
      (...args) => {
        const promise = guarded(...args);
        queued.resolve();
        return promise;
      },
    );
    let pending: ReturnType<typeof h.create> | undefined;
    try {
      await h.create();
      const first = h.requests[0];
      if (!first) throw new Error("expected attempt");
      h.setResult(async () => {
        entered.resolve();
        return respond.promise;
      });
      pending = h.create();
      await entered.promise;
      if (phase === "queued") {
        const locked = Promise.withResolvers<void>();
        blocker = runSerializedSqlMutation(h.execSql, async () => {
          locked.resolve();
          await unlock.promise;
        });
        await locked.promise;
      }
      if (phase === "delete") h.setBeforeDelete(() => h.setCurrent(false));
      if (phase === "response") h.setCurrent(false);
      respond.resolve(refusal());
      if (phase === "queued") {
        await queued.promise;
        h.setCurrent(false);
        unlock.resolve();
      }
      expect(await pending).toBeNull();
      expect(await h.attempts()).toEqual([
        { organization_id: first.organizationId },
      ]);
    } finally {
      respond.resolve(refusal());
      unlock.resolve();
      await blocker;
      await pending;
      guardSpy.mockRestore();
      h.close();
    }
  });
}

test("a late terminal response cannot delete the next same-intent attempt", async () => {
  const h = await harness();
  const entered = Promise.withResolvers<void>();
  const respond =
    Promise.withResolvers<RequestResult<CreateOrganizationResponse>>();
  let late: ReturnType<typeof h.create> | undefined;
  try {
    await h.create();
    const first = h.requests[0];
    if (!first) throw new Error("expected attempt");
    h.setResult(async () => {
      entered.resolve();
      return respond.promise;
    });
    late = h.create();
    await entered.promise;
    h.setResult(async () => refusal());
    expect(await h.create()).toBeNull();
    expect(await h.attempts()).toEqual([]);
    h.setResult(async () => refusal({ status: 503 }));
    expect(await h.create()).toBeNull();
    const next = h.requests[3];
    if (!next) throw new Error("expected new attempt");
    expect(next.organizationId).not.toBe(first.organizationId);
    respond.resolve(refusal());
    expect(await late).toBeNull();
    expect(await h.attempts()).toEqual([
      { organization_id: next.organizationId },
    ]);
  } finally {
    respond.resolve(refusal());
    await late;
    h.close();
  }
});

test("creation transition table ignores stale events and preserves recovery modes", async () => {
  const h = await harness();
  try {
    await h.create();
    const request = h.requests[0];
    if (!request) throw new Error("expected request");
    const pending = { status: "pending" as const, request };
    const result = refusal();
    const event = { type: "result" as const, request, result };
    expect(
      transitionOrganizationCreation(pending, { ...event, result: null }),
    ).toBe(pending);
    expect(
      transitionOrganizationCreation(pending, {
        ...event,
        request: { ...request },
      }),
    ).toBe(pending);
    const refused = transitionOrganizationCreation(pending, event);
    expect(refused).toEqual({ status: "refused", request });
    expect(transitionOrganizationCreation(refused, event)).toBe(refused);
    const response = await respondToOrganizationProvisioning(request);
    const received = transitionOrganizationCreation(pending, {
      ...event,
      result: { ok: true, data: response },
    });
    expect(received).toEqual({ status: "received", request, response });
    expect(transitionOrganizationCreation(received, event)).toBe(received);
    for (const recovery of [
      { ...request, replacesOrganizationId: crypto.randomUUID() },
      { ...request, nativeSubscriptionRestore: true as const },
    ]) {
      const state = { status: "pending" as const, request: recovery };
      expect(
        transitionOrganizationCreation(state, { ...event, request: recovery }),
      ).toBe(state);
    }
  } finally {
    h.close();
  }
});
