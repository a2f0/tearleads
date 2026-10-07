import { Buffer } from "node:buffer";
import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { isReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { readConfiguredDocumentSyncCursorHmacKey } from "../../utils/serverSecrets";
import { principalHistoryHead } from "./principalHistoryRecords";
import { PrincipalPolicyError } from "./shared";

const domain = "tearleads.projection-policy-history.read-grant.v1";
const processKey = randomBytes(32);

export interface ProjectionPolicyHistoryScope {
  readonly organizationId: string;
  readonly objectKind: "container" | "document" | "organization";
  readonly objectId: string;
  readonly userId: string;
}

export interface ProjectionPolicyHistoryGrant
  extends ProjectionPolicyHistoryScope {
  readonly head: ReferencedPrincipalHead;
}

function signature(payload: string): Buffer {
  const configured = readConfiguredDocumentSyncCursorHmacKey();
  const key =
    configured === null
      ? Buffer.from(processKey)
      : Buffer.from(
          hkdfSync("sha256", configured, Buffer.alloc(0), domain, 32),
        );
  try {
    return createHmac("sha256", key)
      .update(domain)
      .update("\0")
      .update(payload)
      .digest();
  } finally {
    key.fill(0);
  }
}

/** Issue only after authorizing the object and checking its signed policy bindings. */
export function issueProjectionPolicyHistoryGrant(
  input: ProjectionPolicyHistoryGrant,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      organizationId: input.organizationId,
      objectKind: input.objectKind,
      objectId: input.objectId,
      userId: input.userId,
      head: principalHistoryHead(input.head),
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

/** This is a read scope, never a verification checkpoint. Recheck live object access on every page. */
export function readProjectionPolicyHistoryGrant(
  token: string,
  userId: string,
): ProjectionPolicyHistoryGrant {
  const reject = () =>
    new PrincipalPolicyError("Projection policy history grant is invalid", 403);
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    throw reject();
  const [payload, encodedSignature] = token.split(".");
  if (!payload || !encodedSignature) throw reject();
  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = signature(payload);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw reject();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw reject();
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("organizationId" in value) ||
    typeof value.organizationId !== "string" ||
    !value.organizationId ||
    !("objectKind" in value) ||
    (value.objectKind !== "container" &&
      value.objectKind !== "document" &&
      value.objectKind !== "organization") ||
    !("objectId" in value) ||
    typeof value.objectId !== "string" ||
    !value.objectId ||
    !("userId" in value) ||
    value.userId !== userId ||
    !("head" in value) ||
    !isReferencedPrincipalStateResponse(value.head)
  )
    throw reject();
  return {
    organizationId: value.organizationId,
    objectKind: value.objectKind,
    objectId: value.objectId,
    userId,
    head: value.head,
  };
}
