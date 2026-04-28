import { afterAll } from "bun:test";

function shouldCloseApiAdapters(): boolean {
  const testTargets = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));

  if (testTargets.length === 0) {
    return true;
  }

  return testTargets.some(
    (target) =>
      target === "packages/api" ||
      target.startsWith("packages/api/") ||
      target.startsWith("./packages/api/"),
  );
}

if (shouldCloseApiAdapters()) {
  afterAll(async () => {
    const { closeApiTestAdapters } = await import(
      "../packages/api/test/cleanup"
    );

    await closeApiTestAdapters();
  });
}
