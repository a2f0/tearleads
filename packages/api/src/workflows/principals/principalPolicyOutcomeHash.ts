import { createHash } from "node:crypto";
import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { PrincipalPolicyError } from "./shared";

function hashCanonicalJson(value: unknown): string {
  try {
    return createHash("sha256")
      .update(
        serializeKeyingCanonicalJson(
          readKeyingCanonicalJson(
            JSON.parse(JSON.stringify(value)),
            "Principal policy outcome request",
          ),
        ),
      )
      .digest("hex");
  } catch {
    throw new PrincipalPolicyError(
      "Principal policy outcome request is not canonical",
      400,
    );
  }
}

function userIdOf(envelope: unknown): string {
  const userId: unknown =
    envelope !== null && typeof envelope === "object"
      ? Reflect.get(envelope, "userId")
      : undefined;
  return typeof userId === "string" ? userId : "";
}

/** Every `memberEnvelopes` list in user-id order; envelopes are a set. */
function withCanonicalEnvelopeOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withCanonicalEnvelopeOrder);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "memberEnvelopes" && Array.isArray(entry)
        ? [...entry].sort((left, right) => {
            const [a, b] = [userIdOf(left), userIdOf(right)];
            return a < b ? -1 : a > b ? 1 : 0;
          })
        : withCanonicalEnvelopeOrder(entry),
    ]),
  );
}

/**
 * The outcome key of a principal policy request, with its envelope lists in
 * user-id order, so a list sent in full and one rebuilt from changes (#2903
 * P17) replay each other even after the head has moved on. `matches` adds the
 * as-sent hash when it differs: receipts stored before the order became
 * canonical were keyed by it.
 */
export function principalPolicyOutcomeHashes(value: unknown): {
  readonly matches: readonly string[];
  readonly requestHash: string;
} {
  const requestHash = hashCanonicalJson(withCanonicalEnvelopeOrder(value));
  const asSent = hashCanonicalJson(value);
  return {
    matches: asSent === requestHash ? [requestHash] : [requestHash, asSent],
    requestHash,
  };
}
