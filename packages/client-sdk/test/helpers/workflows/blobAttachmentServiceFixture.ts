import type {
  BlobAttachmentCollaborators,
  BlobAttachmentServiceApi,
} from "../../../src/data/blobs/attachments/collaborators";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { BlobAttachmentService } from "../../../src/workflows/blobs/blobAttachmentService";

/**
 * A service over a fake that implements only the API calls its test path
 * makes; a call it lacks fails as a TypeError, as it did when each workflow
 * took its own API slice. The fake is passed as is, so the transfer pool stays
 * keyed by the same object.
 */
export function createBlobAttachmentServiceFixture(input: {
  readonly api: Partial<BlobAttachmentServiceApi>;
  readonly encapsulationSecretKey?: Uint8Array | null | undefined;
  readonly execSql: ExecSql;
  readonly log?: BlobAttachmentCollaborators["log"];
  readonly reportSecurityIncident?: BlobAttachmentCollaborators["reportSecurityIncident"];
  readonly expectedDownloads?: ConstructorParameters<
    typeof BlobAttachmentService
  >[1];
}): BlobAttachmentService {
  return new BlobAttachmentService(
    {
      api: input.api as BlobAttachmentServiceApi,
      encapsulationSecretKey: input.encapsulationSecretKey ?? null,
      execSql: input.execSql,
      log: input.log,
      reportSecurityIncident: input.reportSecurityIncident,
    },
    input.expectedDownloads,
  );
}
