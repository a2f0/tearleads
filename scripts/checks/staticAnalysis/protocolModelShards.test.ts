import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

interface ModelsJob {
  strategy: {
    matrix: {
      include: { check: string; shard: string; parallelism: number }[];
    };
  };
  steps: {
    name?: string;
    env?: { PROTOCOL_MODEL_SHARD?: string; PROTOCOL_TLC_PARALLELISM?: string };
  }[];
}

async function modelsJob() {
  const workflow = Bun.YAML.parse(
    await Bun.file(`${root}/.github/workflows/protocol-models.yml`).text(),
  ) as { jobs: { models: ModelsJob } };
  return workflow.jobs.models;
}

// The runs one shard checks, in launch order, from the checker itself.
function listShard(shard: string) {
  const result = Bun.spawnSync(
    ["sh", "scripts/checks/checkProtocolModels.sh", "--list"],
    {
      cwd: root,
      env: { ...process.env, PROTOCOL_MODEL_SHARD: shard },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().split("\n").filter(Boolean);
}

test("CI's model shards check every registered model exactly once", async () => {
  const shards = (await modelsJob()).strategy.matrix.include
    .filter(({ check }) => check === "check:protocol-models")
    .map(({ shard }) => shard);
  expect(shards.length).toBeGreaterThan(1);
  // One count, every index once: a missing index leaves its runs unchecked.
  const expected = Array.from(
    { length: shards.length },
    (_, i) => `${i + 1}/${shards.length}`,
  );
  expect(shards.toSorted()).toEqual(expected.toSorted());
  const listed = shards.map(listShard);
  for (const runs of listed) expect(runs.length).toBeGreaterThan(0);
  const registered = (
    await Bun.file(`${root}/formal/protocol-models.txt`).text()
  )
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
  expect(listed.flat().toSorted()).toEqual(registered.toSorted());
});

test("the model check step takes its shard and parallelism from the matrix", async () => {
  const job = await modelsJob();
  const step = job.steps.find(({ name }) => name === "Run model check");
  expect(step?.env?.PROTOCOL_MODEL_SHARD).toBe(`$${"{{ matrix.shard }}"}`);
  expect(step?.env?.PROTOCOL_TLC_PARALLELISM).toBe(
    `$${"{{ matrix.parallelism }}"}`,
  );
  for (const { check, shard, parallelism } of job.strategy.matrix.include) {
    expect(Number.isInteger(parallelism) && parallelism > 0).toBe(true);
    // The negative controls ignore the shard, so only the models carry one.
    if (check !== "check:protocol-models") expect(shard).toBe("");
  }
});
