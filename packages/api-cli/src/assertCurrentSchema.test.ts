import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { assertCurrentApiSchema } from "./assertCurrentSchema";

test("the migration guard rejects an old schema and accepts the current baseline", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "destroy and reprovision the database",
    );
    await managed.migrate();
    await expect(assertCurrentApiSchema(managed.db)).resolves.toBeUndefined();
  } finally {
    await managed.close();
  }
});
