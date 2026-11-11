import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestExecSql } from "@tearleads/test-utils";
import { runContainerRemovalBounds } from "../../../../test/helpers/containerRemovalBounds";

const fixturePath = fileURLToPath(
  new URL(
    "../../../../test/helpers/containerRemovalBounds.ts",
    import.meta.url,
  ),
);

// Exercise V8's ordinary argument limit; Bun's main-thread stack accepts this
// many arguments. No lowered stack limit, synthetic rows, or mocked repair.
const nodeFixture = `
import { DatabaseSync } from 'node:sqlite';
import { runContainerRemovalBounds } from ${JSON.stringify(fixturePath)};
const database = new DatabaseSync(':memory:');
const statements = new Map();
const execSql = async (sql, bind, options) => {
  if (!bind && /;\\s*\\S/.test(sql.trim().replace(/;\\s*$/, ''))) {
    database.exec(sql);
    return [];
  }
  const statement = statements.get(sql) ?? database.prepare(sql);
  statements.set(sql, statement);
  statement.setReturnArrays(options?.rowMode === 'array');
  return Array.isArray(bind) ? statement.all(...bind)
    : bind ? statement.all(bind) : statement.all();
};
try {
  console.log(JSON.stringify(await runContainerRemovalBounds(execSql, 131073)));
} finally {
  database.close();
}
`;

test("populated removal preserves projection order and effects on WASM SQLite", async () => {
  const db = await createTestExecSql("removal-result-order");
  try {
    expect(await runContainerRemovalBounds(db.execSql, 1001)).toMatchObject({
      selected: 1001,
      updates: 1001,
    });
  } finally {
    db.close();
  }
});

test("populated removal stays within V8 argument limits on real SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "removal-arguments-"));
  const entry = join(directory, "entry.mjs");
  try {
    const require = createRequire(import.meta.url);
    const loroPath = createRequire(require.resolve("@tearleads/loro")).resolve(
      "loro-crdt",
    );
    await writeFile(entry, nodeFixture);
    const build = await Bun.build({
      entrypoints: [entry],
      outdir: directory,
      naming: "fixture.mjs",
      target: "node",
      plugins: [
        {
          name: "native-loro",
          setup(builder) {
            // Its native snippets stay beside the installed package entrypoint.
            builder.onResolve({ filter: /^loro-crdt$/ }, () => ({
              path: loroPath,
              external: true,
            }));
          },
        },
      ],
    });
    expect(build.success).toBe(true);
    const child = Bun.spawn(["node", join(directory, "fixture.mjs")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (stderr) process.stderr.write(stderr);
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        count: 131073,
        selected: 131073,
        updates: 131073,
      });
    } finally {
      child.kill();
      await child.exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
