import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";

/** A real SDK client using the test API and caller-owned local SQLite. */
export async function createHeadlessApiClient(execSql: ExecSql, id: string) {
  const sdk = new Tearleads({
    apiBaseUrl: "http://localhost:3001",
    blobStore: createMemoryBlobStore(),
    database: {
      id,
      client: {
        async exec({ sql, bind, rowMode }) {
          return {
            rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
          };
        },
      },
    },
    logger: { log: () => undefined, logError: () => undefined },
    online: true,
  });
  try {
    await sdk.identity.setKeyPairs({
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    await sdk.session.bootstrapLocalRootContainer();
    const registered = await sdk.session.registerIdentity();
    if (!registered || !(await sdk.session.login(registered.challenge))) {
      throw new Error("Test client registration or login failed");
    }
    return sdk;
  } catch (error) {
    sdk.dispose();
    throw error;
  }
}
