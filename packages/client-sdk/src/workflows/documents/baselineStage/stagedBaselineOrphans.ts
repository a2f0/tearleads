import { DOCUMENT_BASELINE_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import { DOCUMENT_BASELINE_STAGE_IDLE_SECONDS } from "@tearleads/validators/util";
import type {
  DocumentBaselineOpenStage,
  DocumentBaselineStageApi,
} from "../../../data/documents/shared/sync/baselineStageApi";
import type { StagedBaselineUploads } from "./stagedBaselineUploads";

/**
 * How long a stage must have gone untouched before a writer that is not
 * uploading it takes it for an orphan. A live upload touches its stage with
 * every segment, so one this idle is a stage a restarted process left, or
 * an upload that has stalled; a stage another device of the same user is
 * filling right now is younger than this and is left alone.
 */
export const ORPHANED_STAGE_IDLE_MS = 10 * 60 * 1000;

/**
 * When the stage was last touched, as far as its expiry says: a stage
 * expires an idle period after its last staged segment or re-signed header.
 * One held to its maximum age expires sooner than that and so reads as idle
 * for longer; it is about to expire whoever is filling it.
 */
function lastTouchedAt(stage: DocumentBaselineOpenStage): number {
  return (
    Date.parse(stage.expiresAt) - DOCUMENT_BASELINE_STAGE_IDLE_SECONDS * 1000
  );
}

interface OrphanedStageSearch {
  readonly api: DocumentBaselineStageApi;
  /** This device's clock, which the stages' expiries are read against. */
  readonly now: number;
  readonly openStages: readonly DocumentBaselineOpenStage[];
  readonly uploads: StagedBaselineUploads;
}

/**
 * Abandon the user's open stages that no upload of this database is filling
 * and that have been idle long enough to be orphans, and say how many are
 * gone. A user holds few open stages, and one a restarted process left
 * would hold its place until it expired; the refusal that reports the limit
 * names them, and only then does the writer look.
 *
 * Two devices of one user both see each other's stages here. Neither is
 * tracked by the other, so the idle rule is what keeps them from abandoning
 * each other's live uploads. It reads the API's expiry against this
 * device's clock: a device whose clock runs that far ahead can take a live
 * stage for an orphan, and the upload that loses its stage opens another
 * and sends its segments again. A stage whose expiry does not parse is left
 * alone.
 */
export async function abandonOrphanedStages(
  input: OrphanedStageSearch,
): Promise<number> {
  let abandoned = 0;
  for (const stage of input.openStages) {
    const touchedAt = lastTouchedAt(stage);
    if (
      input.uploads.tracks(stage.documentId, stage.baselineId) ||
      !Number.isFinite(touchedAt) ||
      input.now - touchedAt < ORPHANED_STAGE_IDLE_MS
    ) {
      continue;
    }
    // Best effort: a stage the API keeps still holds its place.
    const result = await input.api
      .abandonDocumentBaselineStageResult(stage.documentId, stage.baselineId, {
        reportErrors: false,
      })
      .catch(() => null);
    // A stage already gone has freed its place as well.
    if (
      result?.ok ||
      result?.code === DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound
    ) {
      abandoned += 1;
    }
  }
  return abandoned;
}

type OpenResult = Awaited<
  ReturnType<DocumentBaselineStageApi["openDocumentBaselineStageResult"]>
>;

/**
 * Open a stage, and answer the open-stage limit once: the stages the
 * refusal names that nobody is filling are abandoned, and the open is sent
 * again if that freed a place. A second refusal, or one that named no
 * orphan, is the caller's to report.
 */
export async function openPastOrphanedStages(
  open: () => Promise<OpenResult>,
  search: Pick<OrphanedStageSearch, "api" | "uploads">,
): Promise<OpenResult> {
  const result = await open();
  if (
    result.ok ||
    result.code !== DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached
  ) {
    return result;
  }
  const abandoned = await abandonOrphanedStages({
    ...search,
    now: Date.now(),
    openStages: result.openStages ?? [],
  });
  return abandoned > 0 ? open() : result;
}
