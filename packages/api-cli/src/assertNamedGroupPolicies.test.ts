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
      "destroy and reprovision",
    );
    expect(await managed.db.select().from(principalStatePayloads)).toHaveLength(
      3,
    );
  } finally {
    await managed.close();
  }
}, 15_000);
