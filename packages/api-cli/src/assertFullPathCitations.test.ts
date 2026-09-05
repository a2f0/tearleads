import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { accessEvents, accessManifests } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { assertCurrentApiSchema } from "./assertCurrentSchema";

async function fixture() {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  await managed.migrate();
  const organizationId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const childId = crypto.randomUUID();
  // Deployment checks inspect persisted shapes only. These rows deliberately
  // make no claim to be cryptographic test evidence.
  await managed.db.insert(accessManifests).values(
    [
      { id: rootId, parentContainerId: null, hash: "root-head" },
      { id: childId, parentContainerId: rootId, hash: "child-head" },
    ].map((row) => ({
      version: 1,
      objectKind: "container" as const,
      objectId: row.id,
      organizationId,
      epoch: 1,
      eventHash: row.hash,
      structuralHash: "shape",
      grantRoot: "grants",
      referencedPrincipalHeads: [],
      keyTargetHash: "key",
      manifestHash: row.hash,
      state: { containerId: row.id, parentContainerId: row.parentContainerId },
    })),
  );
  const row = (index: number, dependencyManifestHashes: string[]) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "document.link" as const,
    objectKind: "document" as const,
    objectId: crypto.randomUUID(),
    organizationId,
    dependencyManifestHashes,
    bodyHash: "body",
    body: {},
    eventHash: crypto.randomUUID(),
    signerUserId: crypto.randomUUID(),
    signerDeviceId: "device",
    signerKeyFingerprint: "key",
    signature: "signature",
    signedAt: new Date(),
  });
  return { managed, row };
}

test("deployment accepts full citations and refuses leaf-only history without rewriting it", async () => {
  const { managed, row } = await fixture();
  try {
    await managed.db
      .insert(accessEvents)
      .values(row(0, ["child-head", "root-head"]));
    await expect(assertCurrentApiSchema(managed.db)).resolves.toBeUndefined();
    await managed.db.insert(accessEvents).values(row(1, ["child-head"]));
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "destroy and reprovision the database",
    );
    expect(await managed.db.select().from(accessEvents)).toHaveLength(2);
  } finally {
    await managed.close();
  }
}, 15_000);

test("deployment inspects full-path history beyond the first bounded page", async () => {
  const { managed, row } = await fixture();
  try {
    await managed.db
      .insert(accessEvents)
      .values(
        Array.from({ length: 257 }, (_, index) =>
          row(index, index === 256 ? ["child-head"] : ["root-head"]),
        ),
      );
    let selectCalls = 0;
    const counted = new Proxy(managed.db, {
      get(target, property, receiver) {
        if (property === "select")
          return (...args: unknown[]) => {
            selectCalls += 1;
            return Reflect.apply(target.select, target, args);
          };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(assertCurrentApiSchema(counted)).rejects.toThrow(
      "complete signed container path",
    );
    expect(selectCalls).toBeLessThanOrEqual(10);
  } finally {
    await managed.close();
  }
}, 15_000);

test.each([
  "document.link",
  "document.unlink",
  "attachment.bind",
  "attachment.detach",
] as const)("deployment checks %s citation shapes", async (eventType) => {
  const { managed, row } = await fixture();
  try {
    await managed.db.insert(accessEvents).values({
      ...row(0, ["child-head"]),
      eventType,
      objectKind: eventType.startsWith("attachment") ? "blob" : "document",
      body: eventType.startsWith("attachment")
        ? { documentManifestHash: "document-head" }
        : {},
    });
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "complete signed container path",
    );
  } finally {
    await managed.close();
  }
}, 15_000);

test("retained blob events may name purged metadata document history", async () => {
  const { managed, row } = await fixture();
  try {
    await managed.db.insert(accessEvents).values({
      ...row(0, ["root-head", "child-head", "purged-document-head"]),
      eventType: "attachment.bind",
      objectKind: "blob",
      body: { documentManifestHash: "purged-document-head" },
    });
    await expect(assertCurrentApiSchema(managed.db)).resolves.toBeUndefined();
  } finally {
    await managed.close();
  }
}, 15_000);

test.each([
  "foreign-org",
  "duplicate-head",
  "malformed-state",
  "invalid-parent",
] as const)("deployment refuses %s citation evidence without modifying it", async (corruption) => {
  const { managed, row } = await fixture();
  try {
    const [root] = await managed.db
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, "root-head"));
    if (!root) throw new Error("Expected fixture root");
    const dependencies = ["root-head", "child-head"];
    if (corruption === "duplicate-head") {
      await managed.db.insert(accessManifests).values({
        ...root,
        id: crypto.randomUUID(),
        manifestHash: "second-root",
        eventHash: "second-root-event",
        epoch: 2,
      });
      dependencies.push("second-root");
    } else {
      await managed.db
        .update(accessManifests)
        .set(
          corruption === "foreign-org"
            ? { organizationId: crypto.randomUUID() }
            : {
                state:
                  corruption === "malformed-state"
                    ? []
                    : { parentContainerId: 42 },
              },
        )
        .where(eq(accessManifests.manifestHash, "root-head"));
    }
    await managed.db.insert(accessEvents).values(row(0, dependencies));
    const before = await managed.db.select().from(accessManifests);
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "complete signed container path",
    );
    expect(await managed.db.select().from(accessManifests)).toEqual(before);
  } finally {
    await managed.close();
  }
}, 15_000);

test("deployment refuses a malformed attachment document reference", async () => {
  const { managed, row } = await fixture();
  try {
    await managed.db.insert(accessEvents).values({
      ...row(0, ["root-head"]),
      eventType: "attachment.bind",
      objectKind: "blob",
      body: { documentManifestHash: 42 },
    });
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "complete signed container path",
    );
  } finally {
    await managed.close();
  }
}, 15_000);
