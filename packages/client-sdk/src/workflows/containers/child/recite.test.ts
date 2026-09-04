import { expect, test } from "bun:test";
import { MAX_CONTAINER_RECITATION_EPOCH } from "@tearleads/crypto";
import { createContainerReciteScenario } from "../../../../test/helpers/containerReciteFixtures";
import { heldContainerSnapshot } from "../../../data/containers/shared/heldContainerHeads";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { reciteHeldDescendants } from "./recite";
import { buildContainerRecitePlan } from "./recitePlan";

type Scenario = Awaited<ReturnType<typeof createContainerReciteScenario>>;

test("the SDK does not sign re-citations after the history budget", async () => {
  const scenario = await createContainerReciteScenario();
  try {
    const held = heldContainerSnapshot(
      scenario.execSql,
      scenario.parent.author.organizationId,
    );
    const child = held.heads.get("held-child");
    if (!child) throw new Error("Expected held child");
    // Exercise the planner boundary, not cryptographic chain verification.
    await expect(
      buildContainerRecitePlan({
        author: scenario.parent.author,
        path: [
          {
            ...child,
            state: { ...child.state, epoch: MAX_CONTAINER_RECITATION_EPOCH },
          },
        ],
        policies: held.policies,
      }),
    ).rejects.toThrow("history budget is exhausted");
    expect(scenario.requests).toEqual([]);
  } finally {
    await scenario.close();
  }
});

function cascadeInput(scenario: Scenario) {
  return {
    reportSecurityIncident: async () => {},
    apiClient: { reciteContainer: scenario.reciteContainer },
    author: scenario.parent.author,
    ancestorIds: [scenario.parent.projection.containerId],
    execSql: scenario.execSql,
  };
}

async function checkpoint(scenario: Scenario, id: string) {
  return loadAccessManifestCheckpoint(
    scenario.execSql,
    "container",
    scenario.parent.author.organizationId,
    id,
  );
}

test("held descendants re-cite full current paths parent-first without changing keys or grants", async () => {
  const scenario = await createContainerReciteScenario();
  try {
    const ancestor = await scenario.advanceAncestor();
    await reciteHeldDescendants(cascadeInput(scenario));
    expect(scenario.responses.map((response) => response.containerId)).toEqual([
      "held-child",
      "held-grandchild",
    ]);
    const childResponse = scenario.responses[0];
    const grandchildResponse = scenario.responses[1];
    if (!childResponse || !grandchildResponse)
      throw new Error("Expected both acknowledgements");
    expect(scenario.requests[0]?.event).toMatchObject({
      dependencyManifestHashes: expect.arrayContaining([ancestor.manifestHash]),
    });
    expect(scenario.requests[1]?.event).toMatchObject({
      dependencyManifestHashes: expect.arrayContaining([
        childResponse.manifestHead.manifestHash,
      ]),
    });
    expect(childResponse.accessManifest.state).toMatchObject({
      directGrants: [],
      containerKeyEpochId: Reflect.get(
        scenario.child.bundle.state,
        "containerKeyEpochId",
      ),
      parentManifestHash: Reflect.get(
        scenario.child.bundle.state,
        "parentManifestHash",
      ),
    });
    expect((await checkpoint(scenario, "held-child"))?.manifestHash).toBe(
      childResponse.manifestHead.manifestHash,
    );
    expect((await checkpoint(scenario, "held-grandchild"))?.manifestHash).toBe(
      grandchildResponse.manifestHead.manifestHash,
    );
  } finally {
    await scenario.close();
  }
});

test.each([
  "refused",
  "throws",
  "mismatched",
  "injected-grants",
] as const)("a %s re-cite neither retries nor blocks another held descendant", async (failure) => {
  const scenario = await createContainerReciteScenario();
  try {
    await scenario.advanceAncestor();
    const attempts: string[] = [];
    const incidents: unknown[] = [];
    await reciteHeldDescendants({
      ...cascadeInput(scenario),
      reportSecurityIncident: async (error, context) => {
        incidents.push({ error, context });
      },
      apiClient: {
        reciteContainer: async (id, request) => {
          attempts.push(id);
          if (id !== "held-child") return scenario.reciteContainer(id, request);
          if (failure === "refused") return null;
          if (failure === "throws") throw new Error("offline");
          if (failure === "injected-grants") {
            const response = await scenario.reciteContainer(id, request);
            return {
              ...response,
              accessManifest: {
                ...response.accessManifest,
                state: {
                  ...response.accessManifest.state,
                  directGrants: [
                    {
                      subjectType: "user",
                      subjectId: "intruder",
                      accessLevel: "admin",
                    },
                  ],
                },
              },
            };
          }
          return {
            ...(await scenario.reciteContainer(id, request)),
            containerId: "wrong-container",
          };
        },
      },
    });
    expect(attempts).toEqual(["held-child", "held-grandchild"]);
    expect(incidents).toHaveLength(
      failure === "mismatched" || failure === "injected-grants" ? 1 : 0,
    );
    if (incidents.length) {
      expect(incidents[0]).toMatchObject({
        error: { code: "object_mismatch" },
        context: {
          operation: "container.recite.acknowledge",
          objectId: "held-child",
        },
      });
    }
    expect((await checkpoint(scenario, "held-child"))?.manifestHash).toBe(
      scenario.child.bundle.manifestHash,
    );
    // A bad acknowledgement may hide a committed child head. The honest API
    // then rejects the old child path instead of accepting a stale grandchild.
    expect((await checkpoint(scenario, "held-grandchild"))?.epoch).toBe(
      failure === "mismatched" || failure === "injected-grants" ? 1 : 2,
    );
  } finally {
    await scenario.close();
  }
});

test("a durable head newer than held evidence skips the cascade without fetching", async () => {
  const scenario = await createContainerReciteScenario();
  try {
    await scenario.advanceAncestor(false);
    await reciteHeldDescendants(cascadeInput(scenario));
    expect(scenario.requests).toEqual([]);
    expect((await checkpoint(scenario, "held-child"))?.epoch).toBe(1);
  } finally {
    await scenario.close();
  }
});

test("cancellation during a response prevents acknowledgement and later attempts", async () => {
  const scenario = await createContainerReciteScenario();
  try {
    await scenario.advanceAncestor();
    let active = true;
    await reciteHeldDescendants({
      ...cascadeInput(scenario),
      stillCurrent: () => active,
      apiClient: {
        reciteContainer: async (id, request) => {
          const response = await scenario.reciteContainer(id, request);
          active = false;
          return response;
        },
      },
    });
    expect(scenario.requests).toHaveLength(1);
    expect((await checkpoint(scenario, "held-child"))?.epoch).toBe(1);
    expect((await checkpoint(scenario, "held-grandchild"))?.epoch).toBe(1);
  } finally {
    await scenario.close();
  }
});

test("a pass caps write amplification and spaces requests without retrying", async () => {
  const scenario = await createContainerReciteScenario(10);
  const times: number[] = [];
  try {
    await scenario.advanceAncestor();
    await reciteHeldDescendants({
      ...cascadeInput(scenario),
      apiClient: {
        reciteContainer: async () => {
          times.push(performance.now());
          return null;
        },
      },
    });
    expect(times).toHaveLength(8);
    for (let index = 1; index < times.length; index += 1) {
      expect(
        (times[index] ?? 0) - (times[index - 1] ?? 0),
      ).toBeGreaterThanOrEqual(225);
    }
    expect((await checkpoint(scenario, "held-child"))?.epoch).toBe(1);
  } finally {
    await scenario.close();
  }
});

test("a recitation plan refuses a cross-organization held path", async () => {
  const scenario = await createContainerReciteScenario();
  try {
    const snapshot = heldContainerSnapshot(
      scenario.execSql,
      scenario.parent.author.organizationId,
    );
    const head = snapshot.heads.get("held-child");
    if (!head) throw new Error("Expected held child");
    await expect(
      buildContainerRecitePlan({
        author: {
          ...scenario.parent.author,
          organizationId: "another-organization",
        },
        path: [head],
        policies: [],
      }),
    ).rejects.toThrow("cannot cross organizations");
  } finally {
    await scenario.close();
  }
});
