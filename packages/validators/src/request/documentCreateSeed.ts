import type { z } from "zod";
import { arraySchema, loosePlainObject } from "../schema";
import { MAX_CONTAINER_PATH_LENGTH } from "../util/containerLimits";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "../util/documentSyncLimits";
import {
  ContainerManifestPathSchema,
  type ContainerManifestRef,
  type DocumentContentKeyBundleRequest,
  DocumentContentKeyBundleRequestSchema,
  DocumentSyncOutgoingUpdateSchema,
  type DocumentSyncRequest,
  DocumentSyncRequestSchema,
} from "./documentSyncSchema";

const TEXT_ENCODER = new TextEncoder();

/**
 * A create's seed: the one update a document is born with, committed in its
 * create transaction. It carries the update alone; the server takes the rest
 * of the sync it stands for from the create itself (see
 * {@link documentCreateSeedSyncRequest}).
 */
export const DocumentCreateSeedRequestSchema = loosePlainObject({
  // A seed holds exactly one update; the create's seed refinement enforces it.
  outgoingUpdates: arraySchema(
    DocumentSyncOutgoingUpdateSchema,
    MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  ),
});

export type DocumentCreateSeedRequest = z.infer<
  typeof DocumentCreateSeedRequestSchema
>;

/** The parts of a document create its seed's sync is made of. */
export interface DocumentCreateSeedSource {
  readonly contentKeyBundle: DocumentContentKeyBundleRequest;
  readonly targetContainerPathRefs?:
    | readonly ContainerManifestRef[]
    | undefined;
}

const DocumentCreateSeedSourceSchema = loosePlainObject({
  contentKeyBundle: DocumentContentKeyBundleRequestSchema,
  targetContainerPathRefs: ContainerManifestPathSchema.optional(),
});

/**
 * The document sync a create's seed stands for: the seed's update under the
 * create's content-key epoch, expected link-set and target hashes, and target
 * path, with the update's end as the local version. The update's signed write
 * header names the same values, so the sync checks hold it to them exactly as
 * for a standalone first sync. It carries no content-key bundle: the create
 * stores that bundle in the same transaction, and the sync checks the stored
 * one against these hashes.
 */
export function documentCreateSeedSyncRequest(
  create: DocumentCreateSeedSource,
  seed: DocumentCreateSeedRequest,
): DocumentSyncRequest {
  const [update] = seed.outgoingUpdates;
  return {
    ...(create.targetContainerPathRefs === undefined
      ? {}
      : {
          authorizingContainerPathRefs: [[...create.targetContainerPathRefs]],
        }),
    contentKeyEpoch: create.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: create.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: create.contentKeyBundle.targetHash,
    localVersionVector: update?.partialEndVersionVector ?? null,
    outgoingUpdates: [...seed.outgoingUpdates],
    supportsPullPagination: true,
  };
}

/**
 * A seed is exactly one outgoing update. An attachment bind's document sync,
 * a full sync request, also holds no container rekeys.
 */
export function refineSingleUpdateSeed(
  seed:
    | Pick<DocumentSyncRequest, "outgoingUpdates" | "containerRekeys">
    | DocumentCreateSeedRequest
    | undefined,
  context: z.RefinementCtx,
  issue: { readonly message: string; readonly path: string },
): void {
  if (!Array.isArray(seed?.outgoingUpdates)) {
    return;
  }
  const rekeys: unknown = Reflect.get(seed, "containerRekeys");
  if (
    seed.outgoingUpdates.length !== 1 ||
    (Array.isArray(rekeys) && rekeys.length !== 0)
  ) {
    context.addIssue({
      code: "custom",
      message: issue.message,
      path: [issue.path],
    });
  }
}

/**
 * A create seed stands in for the document's first sync, so the sync it
 * stands for is held to the sync request limit the create route's larger
 * ingress ceiling would not apply.
 */
export function refineSeedWithinSyncRequestLimit(
  seed: DocumentSyncRequest | undefined,
  context: z.RefinementCtx,
  path: string,
): void {
  if (seed === undefined) return;
  let bytes: number;
  try {
    bytes = TEXT_ENCODER.encode(JSON.stringify(seed)).byteLength;
  } catch {
    // Opaque fields (such as a write header) can nest too deeply to
    // serialize; such a seed is refused, never thrown on.
    bytes = Number.POSITIVE_INFINITY;
  }
  if (bytes > MAX_DOCUMENT_SYNC_REQUEST_BYTES) {
    context.addIssue({
      code: "custom",
      message: `create seed exceeds ${MAX_DOCUMENT_SYNC_REQUEST_BYTES} serialized bytes`,
      path: [path],
    });
  }
}

/**
 * Fields of a document sync that a create's seed never carries: the API takes
 * them from the create, so a seed naming one (such as a `minLsn` precondition)
 * is refused rather than silently dropped.
 */
const SEED_SYNC_ONLY_FIELDS = [
  "authorizingContainerPathRefs",
  "containerRekeys",
  "contentKeyBundle",
  "contentKeyEpoch",
  "expectedLinkSetManifestHash",
  "expectedTargetHash",
  "historyMode",
  "inlineRekeyCommitId",
  "localVersionVector",
  "minLsn",
  "pullCursor",
  "supportsPullPagination",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Holds a create's seed to its update alone and the sync it stands for to the
 * checks a standalone sync request gets: it must parse as a document sync
 * (unique update ids, an authorizing path for the write, rotation fields)
 * and, `withinSyncLimit`, serialize within the sync request limit. The
 * refinement also runs over values whose fields already failed, so it builds
 * that sync only from a well-formed, bounded seed and create.
 */
export function refineCreateSeedSync(
  create: unknown,
  seed: unknown,
  context: z.RefinementCtx,
  issue: { readonly path: string; readonly withinSyncLimit: boolean },
): void {
  if (!isRecord(seed)) return;
  if (SEED_SYNC_ONLY_FIELDS.some((field) => Object.hasOwn(seed, field))) {
    context.addIssue({
      code: "custom",
      message: "a create seed carries its update alone",
      path: [issue.path],
    });
    return;
  }
  if (!isRecord(create)) return;
  const { contentKeyBundle, targetContainerPathRefs } = create;
  const { outgoingUpdates } = seed;
  // The field schemas report malformed or oversized values; build nothing
  // from them.
  if (
    !Array.isArray(outgoingUpdates) ||
    outgoingUpdates.length !== 1 ||
    !isRecord(contentKeyBundle) ||
    (targetContainerPathRefs !== undefined &&
      (!Array.isArray(targetContainerPathRefs) ||
        targetContainerPathRefs.length > MAX_CONTAINER_PATH_LENGTH))
  )
    return;
  const parsedSeed = DocumentCreateSeedRequestSchema.safeParse(seed);
  const parsedSource = DocumentCreateSeedSourceSchema.safeParse(create);
  if (!parsedSeed.success || !parsedSource.success) return;
  const sync = documentCreateSeedSyncRequest(
    parsedSource.data,
    parsedSeed.data,
  );
  if (!DocumentSyncRequestSchema.safeParse(sync).success) {
    context.addIssue({
      code: "custom",
      message:
        "create seed does not form a valid document sync with the create's content-key bundle and target path",
      path: [issue.path],
    });
    return;
  }
  if (issue.withinSyncLimit)
    refineSeedWithinSyncRequestLimit(sync, context, issue.path);
}
