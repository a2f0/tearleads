import { expect, test } from "bun:test";
import {
  citationDatabase,
  entry,
  hash,
  NOW,
  remember,
} from "../../../../test/helpers/verifiedCitationReads";
import { documentContainerProjection } from "../../sqlite/schema/documentProjectionSchema";
import { loadVerifiedManifestCitations } from "../verifiedManifestBundlePersistence";

for (const engine of ["native", "wasm"] as const)
  for (const kind of ["container", "document"] as const)
    for (const depth of [1, 3, 6, 12])
      test(`${engine} ${kind} citation builder budget at depth ${depth}`, async () => {
        const fixture = await citationDatabase(engine);
        try {
          for (let i = 0; i < depth; i++)
            await fixture.container(`c${i}`, i ? `c${i - 1}` : null);
          if (kind === "document")
            await fixture.db
              .insert(documentContainerProjection)
              .values({
                documentId: "doc",
                containerId: `c${depth - 1}`,
                updatedAt: NOW,
              })
              .run();
          await remember(fixture.execSql, [
            ...Array.from({ length: depth }, (_, i) =>
              entry(`c${i}`, 1, i + 1),
            ),
            entry("c0", 2, 100),
            entry("c0", 3, 101),
            ...(kind === "document" ? [entry("doc", 1, 200, "document")] : []),
          ]);
          fixture.statements.length = 0;
          const citations = await loadVerifiedManifestCitations(
            fixture.execSql,
            {
              kind,
              id: kind === "document" ? "doc" : `c${depth - 1}`,
            },
          );
          expect(
            citations.map((row) => Reflect.get(row, "manifestHash")),
          ).toEqual([
            ...(kind === "document" ? [hash(200)] : []),
            ...Array.from({ length: depth - 1 }, (_, i) => hash(depth - i)),
            hash(101),
            hash(100),
            hash(1),
          ]);
          console.info(
            "citation-builder-count",
            JSON.stringify({
              engine,
              kind,
              depth,
              statements: fixture.statements.length,
              jsonRows: fixture.statements
                .filter(({ sql }) => sql.includes('"bundle_json"'))
                .reduce((n, { rows }) => n + rows, 0),
            }),
          );
          expect(fixture.statements.length).toBeLessThanOrEqual(
            depth + (kind === "document" ? 6 : 5),
          );
        } finally {
          fixture.close();
        }
      });
