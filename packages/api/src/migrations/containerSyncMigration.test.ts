import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

async function executeMigration(client: PGlite, filename: string) {
  const migrationPath = fileURLToPath(
    new URL(`../../drizzle/${filename}`, import.meta.url),
  );
  const migrationSql = await readFile(migrationPath, "utf8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await client.exec(statement);
  }
}

function timestampIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

async function insertLegacyAccessManifest(
  client: PGlite,
  input: {
    readonly createdAt: string;
    readonly directGrants: readonly Record<string, string>[];
    readonly manifestHash: string;
    readonly objectId: string;
    readonly objectKind: "container" | "document";
    readonly organizationId: string;
  },
) {
  await client.query(
    `
      insert into "access_manifests" (
        "version",
        "object_kind",
        "object_id",
        "organization_id",
        "epoch",
        "previous_manifest_hash",
        "event_hash",
        "structural_hash",
        "grant_root",
        "referenced_principal_heads",
        "key_target_hash",
        "manifest_hash",
        "state",
        "created_at"
      )
      values (
        1,
        $1,
        $2,
        $3,
        1,
        null,
        $4,
        $5,
        $6,
        '[]'::jsonb,
        $7,
        $8,
        $9::jsonb,
        $10
      )
    `,
    [
      input.objectKind,
      input.objectId,
      input.organizationId,
      `${input.manifestHash}:event`,
      `${input.manifestHash}:structural`,
      `${input.manifestHash}:grant-root`,
      `${input.manifestHash}:target`,
      input.manifestHash,
      JSON.stringify({ directGrants: input.directGrants }),
      input.createdAt,
    ],
  );
}

test("container sync migration backfills depth, updated timestamps, and direct grant projections", async () => {
  const client = new PGlite({ debug: 0 });

  try {
    await executeMigration(client, "0000_fearless_mandrill.sql");

    const organizationId = crypto.randomUUID();
    const rootContainerId = crypto.randomUUID();
    const childContainerId = crypto.randomUUID();
    const grandchildContainerId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const rootCreatedAt = "2026-05-01T00:00:00.000Z";
    const childCreatedAt = "2026-05-01T00:01:00.000Z";
    const grandchildCreatedAt = "2026-05-01T00:02:00.000Z";
    const documentCreatedAt = "2026-05-01T00:03:00.000Z";

    await client.query(
      `
        insert into "containers" ("id", "organization_id", "parent_id", "created_at")
        values
          ($1, $2, null, $3),
          ($4, $2, $1, $5),
          ($6, $2, $4, $7)
      `,
      [
        rootContainerId,
        organizationId,
        rootCreatedAt,
        childContainerId,
        childCreatedAt,
        grandchildContainerId,
        grandchildCreatedAt,
      ],
    );
    await client.query(
      `
        insert into "documents" ("id", "created_by_fingerprint", "created_at")
        values ($1, $2, $3)
      `,
      [documentId, "fingerprint:owner", documentCreatedAt],
    );
    await insertLegacyAccessManifest(client, {
      createdAt: rootCreatedAt,
      directGrants: [
        {
          accessLevel: "admin",
          subjectType: "user",
          subjectId: userId,
        },
      ],
      manifestHash: "manifest:root",
      objectId: rootContainerId,
      objectKind: "container",
      organizationId,
    });
    await insertLegacyAccessManifest(client, {
      createdAt: childCreatedAt,
      directGrants: [
        {
          accessLevel: "read",
          subjectType: "group",
          subjectId: groupId,
        },
      ],
      manifestHash: "manifest:child",
      objectId: childContainerId,
      objectKind: "container",
      organizationId,
    });
    await insertLegacyAccessManifest(client, {
      createdAt: documentCreatedAt,
      directGrants: [
        {
          accessLevel: "read",
          subjectType: "user",
          subjectId: userId,
        },
      ],
      manifestHash: "manifest:document",
      objectId: documentId,
      objectKind: "document",
      organizationId,
    });

    await executeMigration(client, "0001_funny_whizzer.sql");

    const containerRows = await client.query<{
      depth: number;
      id: string;
      updatedAt: unknown;
    }>(
      `
        select
          "id"::text as "id",
          "depth",
          "updated_at" as "updatedAt"
        from "containers"
        order by "id"
      `,
    );
    expect(
      new Map(
        containerRows.rows.map((row) => [
          row.id,
          {
            depth: row.depth,
            updatedAt: timestampIso(row.updatedAt),
          },
        ]),
      ),
    ).toEqual(
      new Map([
        [
          childContainerId,
          {
            depth: 1,
            updatedAt: childCreatedAt,
          },
        ],
        [
          grandchildContainerId,
          {
            depth: 2,
            updatedAt: grandchildCreatedAt,
          },
        ],
        [
          rootContainerId,
          {
            depth: 0,
            updatedAt: rootCreatedAt,
          },
        ],
      ]),
    );

    const documentRows = await client.query<{ updatedAt: unknown }>(
      `
        select "updated_at" as "updatedAt"
        from "documents"
        where "id" = $1
      `,
      [documentId],
    );
    expect(timestampIso(documentRows.rows[0]?.updatedAt)).toBe(
      documentCreatedAt,
    );

    const grantRows = await client.query<{
      accessLevel: string;
      containerId: string;
      manifestHash: string;
      subjectId: string;
      subjectType: string;
    }>(
      `
        select
          "manifest_hash" as "manifestHash",
          "container_id" as "containerId",
          "access_level" as "accessLevel",
          "subject_type" as "subjectType",
          "subject_id" as "subjectId"
        from "access_manifest_container_grant_projection"
        order by "manifest_hash", "subject_type", "subject_id"
      `,
    );
    expect(grantRows.rows).toEqual([
      {
        accessLevel: "read",
        containerId: childContainerId,
        manifestHash: "manifest:child",
        subjectId: groupId,
        subjectType: "group",
      },
      {
        accessLevel: "admin",
        containerId: rootContainerId,
        manifestHash: "manifest:root",
        subjectId: userId,
        subjectType: "user",
      },
    ]);
  } finally {
    await client.close();
  }
});
