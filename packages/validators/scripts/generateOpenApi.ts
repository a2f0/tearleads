import { renderDocumentSyncOpenApi } from "../src/operation/openApi";

const artifact = new URL("../../../docs/openapi.json", import.meta.url);
const expected = renderDocumentSyncOpenApi();
const arguments_ = process.argv.slice(2);

if (
  arguments_.length > 1 ||
  (arguments_.length === 1 && arguments_[0] !== "--check")
) {
  throw new Error("Usage: bun scripts/generateOpenApi.ts [--check]");
}

if (arguments_[0] === "--check") {
  const file = Bun.file(artifact);
  const actual = (await file.exists()) ? await file.text() : undefined;
  if (actual !== expected) {
    console.error(
      "docs/openapi.json is stale; run `bun run generate:openapi` and commit the result.",
    );
    process.exitCode = 1;
  }
} else {
  await Bun.write(artifact, expected);
  console.log("Generated docs/openapi.json");
}
