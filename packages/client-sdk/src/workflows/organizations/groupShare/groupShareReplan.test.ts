import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { shareWithGroupReplanningOnce } from "./groupShareReplan";

const stale = () =>
  new ProjectionDependencyUnavailableError(
    "Public history cannot connect to the newer durable checkpoint",
  );

// Methods reach the real client with its own `this`, as a class with private
// state (the SDK's ApiClient) requires.
class FakeShareApi {
  #log: string[] = [];
  evicted: string[] = [];
  get calls(): readonly string[] {
    return this.#log;
  }
  evictContainerWriterProjection(containerId: string): void {
    this.evicted.push(containerId);
  }
  async getContainerWriterProjection(): Promise<null> {
    this.#log.push("read");
    return null;
  }
  async commitOrganizationGroupPolicy(): Promise<null> {
    this.#log.push("commit");
    return null;
  }
  async shareContainer(): Promise<null> {
    this.#log.push("share");
    return null;
  }
  async commitOrganizationGroupPolicyResult(): Promise<null> {
    this.#log.push("commit-result");
    return null;
  }
  async reciteContainer(): Promise<null> {
    this.#log.push("recite");
    return null;
  }
  async listContainerParentLanes(): Promise<null> {
    this.#log.push("list");
    return null;
  }
}

function shareInput(api: FakeShareApi, stillCurrent?: () => boolean) {
  return {
    apiClient: api,
    containerId: "container-1",
    previousProjection: {} as ContainerWriterProjectionResponse,
    stillCurrent,
  };
}

type Attempt = (input: ReturnType<typeof shareInput>) => Promise<string>;

async function run(
  steps: ReadonlyArray<Attempt>,
  stillCurrent?: () => boolean,
) {
  const api = new FakeShareApi();
  const seen: Array<ContainerWriterProjectionResponse | undefined> = [];
  let index = 0;
  const outcome = await shareWithGroupReplanningOnce(
    shareInput(api, stillCurrent),
    (input) => {
      seen.push(input.previousProjection);
      const step = steps[index];
      index += 1;
      if (!step) throw new Error("Unexpected extra attempt");
      return step(input);
    },
  ).catch((error: unknown) => error);
  return { api, outcome, seen };
}

test("stale evidence before any write is planned once more from a fresh projection", async () => {
  const { api, outcome, seen } = await run([
    async (input) => {
      await input.apiClient.getContainerWriterProjection();
      throw stale();
    },
    async (input) => {
      await input.apiClient.commitOrganizationGroupPolicy();
      return "shared";
    },
  ]);
  expect(outcome).toBe("shared");
  expect(api.evicted).toEqual(["container-1"]);
  expect(api.calls).toEqual(["read", "commit"]);
  // The replan drops the handed projection so the share fetches a fresh one.
  expect(seen[0]).toBeDefined();
  expect(seen[1]).toBeUndefined();
});

test("a rollback before any write is planned once more", async () => {
  const { api, outcome } = await run([
    async () => {
      throw new KeyingVerificationError("rollback", "Head is older");
    },
    async () => "shared",
  ]);
  expect(outcome).toBe("shared");
  expect(api.evicted).toEqual(["container-1"]);
});

test("stale evidence after a group policy write is never replanned", async () => {
  const { api, outcome } = await run([
    async (input) => {
      await input.apiClient.commitOrganizationGroupPolicy();
      throw stale();
    },
  ]);
  expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(api.calls).toEqual(["commit"]);
  expect(api.evicted).toEqual([]);
});

// The runtime path commits through the status-bearing method, and any method
// not known to be a read counts as a write, so a new write cannot slip past.
for (const write of [
  "commitOrganizationGroupPolicyResult",
  "reciteContainer",
] as const) {
  test(`stale evidence after ${write} is never replanned`, async () => {
    const { api, outcome } = await run([
      async (input) => {
        await input.apiClient[write]();
        throw stale();
      },
    ]);
    expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
    expect(api.evicted).toEqual([]);
  });
}

test("reads before stale evidence still allow the replan", async () => {
  const { api, outcome } = await run([
    async (input) => {
      await input.apiClient.getContainerWriterProjection();
      await input.apiClient.listContainerParentLanes();
      throw stale();
    },
    async () => "shared",
  ]);
  expect(outcome).toBe("shared");
  expect(api.calls).toEqual(["read", "list"]);
});

test("stale evidence after a share submission is never replanned", async () => {
  const { api, outcome } = await run([
    async (input) => {
      await input.apiClient.shareContainer();
      throw stale();
    },
  ]);
  expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(api.evicted).toEqual([]);
});

test("a second stale plan fails the share", async () => {
  const { api, outcome } = await run([
    async () => {
      throw stale();
    },
    async () => {
      throw stale();
    },
  ]);
  expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(api.evicted).toEqual(["container-1"]);
});

test("other failures are final", async () => {
  const { api, outcome } = await run([
    async () => {
      throw new KeyingVerificationError("equivocation", "Conflicting head");
    },
  ]);
  expect(outcome).toMatchObject({ code: "equivocation" });
  expect(api.evicted).toEqual([]);
});

test("a share whose scope ended is not replanned", async () => {
  let current = true;
  const { api, outcome } = await run(
    [
      async () => {
        current = false;
        throw stale();
      },
    ],
    () => current,
  );
  expect(outcome).toBeNull();
  expect(api.evicted).toEqual([]);
});
