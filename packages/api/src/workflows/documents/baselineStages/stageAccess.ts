import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  assertOrganizationCanSync,
  assertOrganizationSyncEndpointAvailable,
} from "../../billing/organizationSyncEligibility";
import { ensureCurrentDocumentAccess } from "../mutations/syncAccess";

interface StageCaller {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly userId: string;
}

/**
 * Every request that writes to a stage is a document write, and is held to
 * what a document write is held to now, not when the stage opened: the
 * caller can write the document through a container it is linked into, and
 * its organization is entitled to sync with a seat for the caller. A writer
 * whose access was revoked, or whose organization lapsed, stages nothing
 * more and its stage stops extending; the request that would commit the
 * stage checks both again. Resolving the document's key targets also proves
 * the document still exists.
 */
export async function requireStageWriter(
  input: StageCaller,
): Promise<{ readonly organizationId: string }> {
  const organizationId = await requireDocumentWriteAccess(input);
  await assertOrganizationCanSync(input.executor, organizationId, input.userId);
  return { organizationId };
}

/**
 * Reading a stage's status writes nothing, so it needs no write entitlement:
 * like a read-only sync it is refused only once the organization's sync
 * endpoint is closed. It still needs the access a stage is for, so a
 * revoked writer learns nothing more of its stage.
 */
export async function requireStageReader(input: StageCaller): Promise<void> {
  await assertOrganizationSyncEndpointAvailable(
    input.executor,
    await requireDocumentWriteAccess(input),
  );
}

async function requireDocumentWriteAccess(input: StageCaller): Promise<string> {
  const targets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.executor,
  );
  await ensureCurrentDocumentAccess({
    containerIds: targets.targets.map((target) => target.containerId),
    executor: input.executor,
    minimumAccessLevel: "write",
    userId: input.userId,
  });
  return targets.organizationId;
}
