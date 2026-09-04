import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { principalStatePayloads } from "@tearleads/api-shared/schema";
import { assertCurrentApiSchema } from "./assertCurrentSchema";

test("deployment refuses unnamed signed group payloads without translating them", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const insert = (
      principalType: "group" | "organization",
      payload: unknown,
    ) =>
      managed.db.insert(principalStatePayloads).values({
        principalType,
        principalId: crypto.randomUUID(),
        stateHash: crypto.randomUUID(),
        cipherSuite: "aes-256-gcm",
        ciphertext: Buffer.from(JSON.stringify(payload)).toString("base64"),
        ciphertextHash: crypto.randomUUID(),
      });
    await insert("organization", { members: [] });
    await insert("group", { members: [], name: "Operators" });
    await expect(assertCurrentApiSchema(managed.db)).resolves.toBeUndefined();
    await insert("group", { members: [] });
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "Group policy payload lacks its signed display name",
    );
    expect(await managed.db.select().from(principalStatePayloads)).toHaveLength(
      3,
    );
  } finally {
    await managed.close();
  }
}, 15_000);

test("deployment checks unnamed groups beyond the first bounded page", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    await managed.db.insert(principalStatePayloads).values(
      Array.from({ length: 257 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        principalType: "group" as const,
        principalId: crypto.randomUUID(),
        stateHash: crypto.randomUUID(),
        cipherSuite: "aes-256-gcm" as const,
        ciphertext: Buffer.from(
          JSON.stringify(
            index === 256
              ? { members: [] }
              : { name: "Operators", members: [] },
          ),
        ).toString("base64"),
        ciphertextHash: crypto.randomUUID(),
      })),
    );
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "Group policy payload lacks its signed display name",
    );
  } finally {
    await managed.close();
  }
}, 15_000);
