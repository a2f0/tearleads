import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { DocumentKekTargetError } from "../../src/access/read/documentKekTargets";

export const staleLink = (link: string, id: string) =>
  new DocumentKekTargetError(
    `Container KEK ${link} is stale for container ${id}`,
    409,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
  );
