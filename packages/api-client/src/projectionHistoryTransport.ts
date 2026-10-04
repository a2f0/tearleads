import {
  captureProjectionHistory,
  type HistoryProjection,
  type RetainedProjectionHistory,
  restoreProjectionHistory,
} from "@tearleads/crypto";
import {
  isContainerWriterProjectionResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  PROJECTION_HISTORY_HINT_CHARACTERS,
  ProjectionHistoryPrefixesSchema,
} from "@tearleads/validators/util";
import type { OperationRequestFn, OperationRequestResultFn } from "./types";
import { registerProjectionHistoryAdmission } from "./verifiedProjectionHistory";

const MAX_HISTORY_CHARACTERS = 16_000_000;
const MAX_PROJECTIONS = 16;
interface RetainedHistory {
  readonly entries: RetainedProjectionHistory[];
  readonly characters: number;
}

/** Session-scoped evidence cache, independent of the short-lived current-head cache. */
export class ProjectionHistoryTransport {
  private readonly retained = new Map<string, RetainedHistory>();
  private characters = 0;
  private generation = 0;

  clear(): void {
    this.generation += 1;
    this.characters = 0;
    this.retained.clear();
  }

  private remember(path: string, entries: RetainedProjectionHistory[]): void {
    const characters = JSON.stringify(entries).length;
    if (characters > MAX_HISTORY_CHARACTERS) return;
    this.characters -= this.retained.get(path)?.characters ?? 0;
    this.retained.delete(path);
    this.retained.set(path, { entries, characters });
    this.characters += characters;
    while (
      this.characters > MAX_HISTORY_CHARACTERS ||
      this.retained.size > MAX_PROJECTIONS
    ) {
      const oldest = this.retained.entries().next().value;
      if (!oldest) break;
      this.characters -= oldest[1].characters;
      this.retained.delete(oldest[0]);
    }
  }

  private prepare<T>(
    path: string,
    validator: (value: unknown) => value is T,
    method: Parameters<OperationRequestFn>[2],
    options: Parameters<OperationRequestFn>[4],
    operation: Parameters<OperationRequestFn>[5],
  ): {
    options: Parameters<OperationRequestFn>[4];
    validator: (value: unknown) => value is T;
  } {
    if (
      method !== "GET" ||
      ![
        "containers.writerProjection.get",
        "documents.writerProjection.get",
      ].includes(operation.id)
    )
      return { options, validator };
    const generation = this.generation;
    const mayRetain = options?.headers === undefined;
    const candidates = mayRetain
      ? (this.retained.get(path)?.entries ?? [])
      : [];
    const requested: RetainedProjectionHistory[] = [];
    for (const entry of candidates) {
      const prefixes = [...requested, entry].map((item) => item.prefix);
      if (!ProjectionHistoryPrefixesSchema.safeParse(prefixes).success)
        continue;
      // Bound negotiation headers; deep paths merely omit fewer hints.
      if (
        encodeURIComponent(JSON.stringify(prefixes)).length <=
        PROJECTION_HISTORY_HINT_CHARACTERS
      )
        requested.push(entry);
    }
    const hint = JSON.stringify(requested.map((entry) => entry.prefix));
    const requestOptions = requested.length
      ? {
          ...options,
          headers: { "x-projection-history": encodeURIComponent(hint) },
        }
      : options;
    return {
      options: requestOptions,
      validator: (value: unknown): value is T => {
        if (!validator(value)) return false;
        let projection: HistoryProjection;
        if (
          isContainerWriterProjectionResponse(value) ||
          isDocumentWriterProjectionResponse(value)
        )
          projection = value;
        else return false;
        if (
          projection.historyPrefixes?.length &&
          generation !== this.generation
        )
          return false;
        if (
          !restoreProjectionHistory(projection, requested) ||
          !validator(value)
        )
          return false;
        const captured = captureProjectionHistory(projection);
        registerProjectionHistoryAdmission(projection, () => {
          if (!mayRetain || generation !== this.generation) return;
          // A consumer may mutate a decoded object. Never retain bytes other
          // than the exact evidence that passed through the verification call.
          const observed = captureProjectionHistory(projection);
          if (
            JSON.stringify(observed.map((entry) => entry.prefix)) !==
            JSON.stringify(captured.map((entry) => entry.prefix))
          )
            return;
          this.remember(path, captured);
        });
        return true;
      },
    };
  }

  wrapRequest(request: OperationRequestFn): OperationRequestFn {
    return (path, validator, method, body, options, operation) => {
      const prepared = this.prepare(
        path,
        validator,
        method,
        options,
        operation,
      );
      return request(
        path,
        prepared.validator,
        method,
        body,
        prepared.options,
        operation,
      );
    };
  }

  wrapRequestResult(
    request: OperationRequestResultFn,
  ): OperationRequestResultFn {
    return (path, validator, method, body, options, operation) => {
      const prepared = this.prepare(
        path,
        validator,
        method,
        options,
        operation,
      );
      return request(
        path,
        prepared.validator,
        method,
        body,
        prepared.options,
        operation,
      );
    };
  }
}
