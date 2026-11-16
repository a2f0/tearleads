import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import type { RemoteDocumentServiceApi } from "../../src/workflows/documents/remote/remoteDocumentCollaborators";
import { RemoteDocumentService } from "../../src/workflows/documents/remote/remoteDocumentService";

/**
 * A service over a fake that implements only the API calls its test path
 * makes; a call it lacks fails as a TypeError, as it did when each workflow
 * took its own API slice. The fake is passed as is, so its `this` binding and
 * identity stay those of the object the test built.
 */
export function createRemoteDocumentServiceFixture(input: {
  readonly api: Partial<RemoteDocumentServiceApi>;
  readonly encapsulationSecretKey?: Uint8Array | null | undefined;
  readonly execSql: ExecSql;
}): RemoteDocumentService {
  return new RemoteDocumentService({
    api: input.api as RemoteDocumentServiceApi,
    encapsulationSecretKey: input.encapsulationSecretKey ?? null,
    execSql: input.execSql,
  });
}
