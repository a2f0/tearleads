import { expect, test } from "bun:test";
import { createContainerReciteScenario } from "../../../../test/helpers/containerReciteFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { reciteHeldDescendants } from "./recite";

type Scenario = Awaited<ReturnType<typeof createContainerReciteScenario>>;

function cascadeInput(scenario: Scenario) {
  return {
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
] as const)("a %s re-cite neither retries nor blocks another held descendant", async (failure) => {
  const scenario = await createContainerReciteScenario();
  try {
    await scenario.advanceAncestor();
    const attempts: string[] = [];
    await reciteHeldDescendants({
      ...cascadeInput(scenario),
      apiClient: {
        reciteContainer: async (id, request) => {
          attempts.push(id);
          if (id !== "held-child") return scenario.reciteContainer(id, request);
          if (failure === "refused") return null;
          if (failure === "throws") throw new Error("offline");
          return {
            ...(await scenario.reciteContainer(id, request)),
            containerId: "wrong-container",
          };
        },
      },
    });
    expect(attempts).toEqual(["held-child", "held-grandchild"]);
    expect((await checkpoint(scenario, "held-child"))?.manifestHash).toBe(
      scenario.child.bundle.manifestHash,
    );
    expect((await checkpoint(scenario, "held-grandchild"))?.epoch).toBe(2);
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
