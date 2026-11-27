// An in-memory stand-in for the API's rotation-baseline stage routes and for
// the part of a rotating request's commit that reads a stage. It holds the
// writer to the contract in docs/document-rotation-baselines.md, "A Baseline
// Staged Ahead": one stage a document, segments strictly in order, a digest
// chained over them, headers that must agree with the final segment's, and
// the coded refusals each of those draws.
import {
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "@tearleads/crypto";
import { historySegmentsImportInOrder } from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentBaselineStageErrorCode,
  type DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";
import { MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER } from "@tearleads/validators/util";
import type {
  DocumentBaselineOpenStage,
  DocumentBaselineStageApi,
  DocumentBaselineStageFailure,
} from "../../../src/data/documents/shared/sync/baselineStageApi";

interface Stage {
  readonly baselineId: string;
  readonly contentKeyCommitment: string;
  readonly contentKeyEpoch: number;
  digest: string;
  expired: boolean;
  readonly segments: DocumentOutgoingUpdate[];
}

/** What a refused commit of a staged baseline answers with. */
export interface StageCommitRefusal {
  readonly baselineStageCode?: DocumentBaselineStageErrorCode;
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

type InjectedFailure = Omit<DocumentBaselineStageFailure, "ok" | "message"> & {
  readonly message?: string;
};

function field(header: Record<string, unknown>, name: string): unknown {
  return header[name];
}

/** The header fields an authorization check reads, as the commit compares. */
function authorizationIdentity(update: DocumentOutgoingUpdate): string {
  const header = update.writeHeader;
  return JSON.stringify(
    [
      "accessManifestHash",
      "targetHash",
      "contentKeyEpoch",
      "writerUserId",
      "writerKeyFingerprint",
      "dependencyManifestHashes",
    ].map((name) => field(header, name)),
  );
}

function refusal(
  code: DocumentBaselineStageErrorCode,
  nextSegmentIndex?: number,
): DocumentBaselineStageFailure {
  return {
    code,
    message: `stage refused: ${code}`,
    ...(nextSegmentIndex === undefined ? {} : { nextSegmentIndex }),
    ok: false,
    status: code === DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound ? 404 : 409,
  };
}

const CODES = DOCUMENT_BASELINE_STAGE_ERROR_CODES;

export class FakeBaselineStageServer {
  /** Every stage request, in order: `open`, `stage:3`, `resign:0`, ... */
  readonly calls: string[] = [];
  /** Every group a commit took, each in index order, final segment last. */
  readonly committed: DocumentOutgoingUpdate[][] = [];
  /** How many bytes of ciphertext were staged, across every stage. */
  stagedCharacters = 0;
  /** Every write header a stage request carried, staged or signed again. */
  readonly headers: Record<string, unknown>[] = [];
  /**
   * The user's open stages on other documents, as a test places them: with
   * four of them an open is refused for the limit and names them, and an
   * abandon removes the one it names.
   */
  readonly elsewhere: DocumentBaselineOpenStage[] = [];
  private readonly stages = new Map<string, Stage>();
  private readonly injected: {
    readonly call: string;
    readonly failure: DocumentBaselineStageFailure;
  }[] = [];
  private readonly before = new Map<string, () => void | Promise<void>>();
  private readonly lost = new Set<string>();

  /** Answer the next request named `call` with `failure`, once. */
  refuseNext(call: string, failure: InjectedFailure): void {
    this.injected.push({
      call,
      failure: { message: `injected ${call}`, ...failure, ok: false },
    });
  }

  /** Run `effect` just before the next request named `call` is handled. */
  beforeNext(call: string, effect: () => void | Promise<void>): void {
    this.before.set(call, effect);
  }

  /** Handle the next request named `call`, then lose its answer. */
  loseNextAnswer(call: string): void {
    this.lost.add(call);
  }

  /** What the writer sees of an answer the network lost. */
  private answered<T>(
    call: string,
    answer: T,
  ): T | DocumentBaselineStageFailure {
    if (!this.lost.delete(call)) return answer;
    return { message: `${call}: network failure`, ok: false, status: null };
  }

  expire(documentId: string): void {
    const stage = this.stages.get(documentId);
    if (stage) stage.expired = true;
  }

  drop(documentId: string): void {
    this.stages.delete(documentId);
  }

  /** Make the stage's digest another than its segments chain to. */
  corruptDigest(documentId: string): void {
    const stage = this.stages.get(documentId);
    if (stage) stage.digest = "f".repeat(64);
  }

  stage(documentId: string): {
    readonly baselineId: string;
    readonly segments: readonly DocumentOutgoingUpdate[];
  } | null {
    return this.stages.get(documentId) ?? null;
  }

  private async enter(call: string) {
    this.calls.push(call);
    const effect = this.before.get(call);
    if (effect) {
      this.before.delete(call);
      await effect();
    }
    const index = this.injected.findIndex((entry) => entry.call === call);
    return index < 0
      ? null
      : (this.injected.splice(index, 1)[0]?.failure ?? null);
  }

  private open(documentId: string, baselineId: string) {
    const stage = this.stages.get(documentId);
    if (!stage || stage.baselineId !== baselineId) {
      return { failure: refusal(CODES.notFound), stage: null };
    }
    if (stage.expired) return { failure: refusal(CODES.expired), stage: null };
    return { failure: null, stage };
  }

  private status(stage: Stage): {
    readonly data: DocumentBaselineStageStatusResponse;
    readonly ok: true;
  } {
    return {
      data: {
        baselineId: stage.baselineId,
        contentKeyCommitment: stage.contentKeyCommitment,
        contentKeyEpoch: stage.contentKeyEpoch,
        expiresAt: "2026-07-26T01:00:00.000Z",
        nextSegmentIndex: stage.segments.length,
        segmentsDigest: stage.digest,
        stagedBytes: stage.segments.reduce(
          (sum, segment) => sum + segment.encryptedData.length,
          0,
        ),
      },
      ok: true,
    };
  }

  private async stageSegment(
    documentId: string,
    baselineId: string,
    segmentIndex: number,
    segment: DocumentOutgoingUpdate,
  ) {
    const { failure, stage } = this.open(documentId, baselineId);
    if (!stage) return failure;
    const next = stage.segments.length;
    if (segmentIndex > next) return refusal(CODES.segmentOutOfOrder, next);
    const ciphertextHash = field(segment.writeHeader, "ciphertextHash");
    const held = stage.segments[segmentIndex];
    if (held) {
      return held.id === segment.id &&
        field(held.writeHeader, "ciphertextHash") === ciphertextHash
        ? this.status(stage)
        : refusal(CODES.segmentConflict);
    }
    if (
      segment.baselineId !== baselineId ||
      segment.baselineSegmentIndex !== segmentIndex ||
      segment.baselineSegmentCount !== undefined ||
      segment.baselineSegmentsDigest !== undefined ||
      segment.coversThroughUpdateId !== undefined ||
      !historySegmentsImportInOrder([...stage.segments, segment])
    ) {
      return refusal(CODES.segmentInvalid);
    }
    const envelope: unknown = JSON.parse(segment.encryptedData);
    if (
      field(segment.writeHeader, "contentKeyEpoch") !== stage.contentKeyEpoch ||
      typeof envelope !== "object" ||
      envelope === null ||
      Reflect.get(envelope, "contentKeyCommitment") !==
        stage.contentKeyCommitment
    ) {
      throw new Error("A staged segment is not encrypted for its stage's key");
    }
    if (stage.segments.some((other) => other.id === segment.id)) {
      return refusal(CODES.segmentConflict);
    }
    stage.segments.push(segment);
    this.stagedCharacters += segment.encryptedData.length;
    stage.digest = await extendDocumentBaselineSegmentsDigest(stage.digest, {
      ciphertextHash: String(ciphertextHash),
      metadataHash: String(field(segment.writeHeader, "metadataHash")),
      segmentIndex,
      updateId: segment.id,
    });
    return this.status(stage);
  }

  private resign(
    documentId: string,
    baselineId: string,
    segmentIndex: number,
    writeHeader: Record<string, unknown>,
  ) {
    const { failure, stage } = this.open(documentId, baselineId);
    if (!stage) return failure;
    const held = stage.segments[segmentIndex];
    if (!held) return refusal(CODES.segmentOutOfOrder, stage.segments.length);
    const same = ["contentRecordId", "metadataHash", "ciphertextHash"].every(
      (name) => field(held.writeHeader, name) === field(writeHeader, name),
    );
    if (!same) return refusal(CODES.segmentConflict);
    stage.segments[segmentIndex] = { ...held, writeHeader };
    return this.status(stage);
  }

  /** The stage routes, as the API client offers them. */
  readonly api: DocumentBaselineStageApi = {
    abandonDocumentBaselineStageResult: async (documentId, baselineId) => {
      const injected = await this.enter("abandon");
      if (injected) return injected;
      const other = this.elsewhere.findIndex(
        (open) =>
          open.documentId === documentId && open.baselineId === baselineId,
      );
      if (other >= 0) {
        this.elsewhere.splice(other, 1);
        return { data: { baselineId }, ok: true };
      }
      const stage = this.stages.get(documentId);
      if (stage?.baselineId !== baselineId) return refusal(CODES.notFound);
      this.stages.delete(documentId);
      return { data: { baselineId }, ok: true };
    },
    getDocumentBaselineStageResult: async (documentId, baselineId) => {
      const injected = await this.enter("get");
      if (injected) return injected;
      const { failure, stage } = this.open(documentId, baselineId);
      return stage ? this.status(stage) : (failure ?? refusal(CODES.notFound));
    },
    openDocumentBaselineStageResult: async (documentId, input) => {
      const injected = await this.enter("open");
      if (injected) return injected;
      if (this.elsewhere.length >= MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER) {
        return {
          ...refusal(CODES.limitReached),
          openStages: [...this.elsewhere],
        };
      }
      const held = this.stages.get(documentId);
      if (
        held &&
        !held.expired &&
        held.baselineId === input.baselineId &&
        held.contentKeyEpoch === input.contentKeyEpoch &&
        held.contentKeyCommitment === input.contentKeyCommitment
      ) {
        return this.status(held);
      }
      const stage: Stage = {
        ...input,
        digest: await startDocumentBaselineSegmentsDigest({
          baselineId: input.baselineId,
          documentId,
        }),
        expired: false,
        segments: [],
      };
      this.stages.set(documentId, stage);
      return this.status(stage);
    },
    resignDocumentBaselineSegmentHeaderResult: async (
      documentId,
      baselineId,
      segmentIndex,
      input,
    ) => {
      this.headers.push(input.writeHeader);
      const injected = await this.enter(`resign:${segmentIndex}`);
      return (
        injected ??
        this.resign(documentId, baselineId, segmentIndex, input.writeHeader) ??
        refusal(CODES.notFound)
      );
    },
    stageDocumentBaselineSegmentResult: async (
      documentId,
      baselineId,
      segmentIndex,
      segment,
    ) => {
      const call = `stage:${segmentIndex}`;
      this.headers.push(segment.writeHeader);
      const injected = await this.enter(call);
      if (injected) return injected;
      const answer = await this.stageSegment(
        documentId,
        baselineId,
        segmentIndex,
        segment,
      );
      return this.answered(call, answer ?? refusal(CODES.notFound));
    },
  };

  /**
   * What the rotating request's commit does with the stage it names: null
   * when the group commits, which empties the stage, or the refusal the
   * route answers with.
   */
  commit(input: {
    readonly baselineStageId: string;
    readonly contentKeyEpoch: number;
    readonly documentId: string;
    readonly final: DocumentOutgoingUpdate;
  }): StageCommitRefusal | null {
    const group = (
      baselineStageCode?: DocumentBaselineStageErrorCode,
    ): StageCommitRefusal => ({
      ...(baselineStageCode === undefined ? {} : { baselineStageCode }),
      code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
      message: `commit refused: ${baselineStageCode ?? "group rule"}`,
      status: 409,
    });
    const { final } = input;
    const stage = this.stages.get(input.documentId);
    if (!stage || stage.baselineId !== input.baselineStageId) {
      return group(CODES.notFound);
    }
    if (stage.expired) return group(CODES.expired);
    if (stage.contentKeyEpoch !== input.contentKeyEpoch) {
      return group(CODES.epochStale);
    }
    const next = stage.segments.length;
    if (final.baselineSegmentIndex !== next) {
      return group(CODES.segmentOutOfOrder);
    }
    if (
      final.baselineId !== stage.baselineId ||
      final.baselineSegmentCount !== next + 1 ||
      final.baselineSegmentsDigest !== stage.digest ||
      !historySegmentsImportInOrder([...stage.segments, final])
    ) {
      return group();
    }
    const identity = authorizationIdentity(final);
    if (stage.segments.some((s) => authorizationIdentity(s) !== identity)) {
      return group(CODES.headersStale);
    }
    this.committed.push([...stage.segments, final]);
    this.stages.delete(input.documentId);
    return null;
  }
}
