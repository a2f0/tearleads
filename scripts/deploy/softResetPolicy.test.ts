import { expect, test } from "bun:test";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";
import { cancelFixture, waitFor } from "./softResetCancel.testUtils";

test.each(["postgres", "storage", "edge", "website"] as const)(
  "%s init cancellation never starts a following command",
  async (stack) => {
    const f = cancelFixture(stack, "init");
    try {
      await waitFor(() => existsSync(join(f.root, "ready.json")));
      f.child.kill("SIGINT");
      expect(await f.child.exited).toBe(130);
      expect(readFileSync(join(f.root, "terraform-calls"), "utf8")).toBe(
        "init\n",
      );
      expect(existsSync(join(f.root, "state-written"))).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
  12_000,
);

test("a state-holding plan receives the same graceful cancellation as apply", async () => {
  const f = cancelFixture("storage", "plan");
  try {
    await waitFor(() => existsSync(join(f.root, "ready.json")));
    f.child.kill("SIGINT");
    expect(await f.child.exited).toBe(130);
    expect(existsSync(join(f.root, "state-written"))).toBe(true);
    expect(readFileSync(join(f.root, "signals"), "utf8")).toBe("SIGINT\n");
  } finally {
    await f.cleanup();
  }
}, 12_000);

test("every Terraform-capable caller declares the state-protecting policy", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "changed-public-inventory"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(f.records().record.steps.at(-1).label).toBe("verify-public");
    const dir = join(f.records().dir, "private");
    const commands = readdirSync(dir)
      .filter((name) => /^command-\d+\.json$/.test(name))
      .map(
        (name) =>
          JSON.parse(readFileSync(join(dir, name), "utf8")) as {
            args: string[];
            interruptPolicy: string;
          },
      );
    const protectedNames = [
      "deployApi.sh",
      "drop-postgres-owned.sh",
      "empty-r2-bucket.sh",
    ];
    const covered = new Set<string>();
    for (const command of commands) {
      const path = command.args[0] ?? "";
      const stateful =
        /run-(postgres|storage|edge|website)-stack.sh$/.test(path) ||
        protectedNames.some((name) => path.endsWith(`/${name}`)) ||
        (command.args[1]?.endsWith("softResetPreflight.sh") &&
          command.args[3] === "api");
      expect(command.interruptPolicy, JSON.stringify(command.args)).toBe(
        stateful ? "terraform-state" : "bounded-command",
      );
      if (stateful)
        covered.add(
          path === "bash" ? "api-readiness" : (path.split("/").at(-1) ?? ""),
        );
    }
    expect([...covered].sort()).toEqual(
      [
        "api-readiness",
        ...protectedNames,
        "run-postgres-stack.sh",
        "run-storage-stack.sh",
        "run-edge-stack.sh",
        "run-website-stack.sh",
      ].sort(),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);
