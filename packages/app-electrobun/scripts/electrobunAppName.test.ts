import { expect, test } from "bun:test";
import { resolve } from "node:path";

const configPath = resolve(import.meta.dirname, "../electrobun.config.ts");

test.each([
  ["darwin", "staging", "TL Staging"],
  ["darwin", "production", "Tearleads"],
  ["darwin", "", "Tearleads"],
  ["linux", "staging", "Tearleads"],
  ["linux", "production", "Tearleads"],
  ["win32", "staging", "Tearleads"],
])(
  "%s %s uses the expected app and window name",
  async (platform, tier, name) => {
    // Load the actual config in isolation so its environment and module cache
    // cannot affect another test, even when run on a non-macOS CI runner.
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
const { default: config } = await import(${JSON.stringify(configPath)});
console.log(JSON.stringify({
  name: config.app.name,
  title: JSON.parse(config.build.bun.define.TEARLEADS_ELECTROBUN_APP_NAME),
  identifier: config.app.identifier,
}));`,
      ],
      {
        env: { ...process.env, ELECTROBUN_RELEASE_TIER: tier },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(error).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual({
      name,
      title: name,
      identifier: "com.tearleads.app",
    });
  },
);
