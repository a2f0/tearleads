import { Buffer } from "node:buffer";
import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { ReferencedPrincipalStateResponseSchema } from "@tearleads/validators/response";
import { z } from "zod";
import { readConfiguredDocumentSyncCursorHmacKey } from "../../utils/serverSecrets";
import { principalHistoryHead } from "./principalHistoryRecords";
import { PrincipalPolicyError } from "./shared";

const domain = "tearleads.projection-policy-history.read-grant.v1";
const processKey = randomBytes(32);

export interface ProjectionPolicyHistoryScope {
  readonly organizationId: string;
  readonly objectKind:
    | "container"
    | "document"
    | "organization"
    | "document-purge";
  readonly objectId: string;
  readonly userId: string;
}

export interface ProjectionPolicyHistoryGrant
  extends ProjectionPolicyHistoryScope {
  readonly head: ReferencedPrincipalHead;
}

/** Unknown keys are ignored; `head` keeps the signed object as issued. */
const ProjectionPolicyHistoryGrantPayloadSchema = z.object({
  version: z.literal(1),
  organizationId: z.string().min(1),
  objectKind: z.literal([
    "container",
    "document",
    "document-purge",
    "organization",
  ]),
  objectId: z.string().min(1),
  userId: z.string(),
  head: ReferencedPrincipalStateResponseSchema,
});

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
  const parsed = ProjectionPolicyHistoryGrantPayloadSchema.safeParse(value);
  if (!parsed.success || parsed.data.userId !== userId) throw reject();
  return {
    organizationId: parsed.data.organizationId,
    objectKind: parsed.data.objectKind,
    objectId: parsed.data.objectId,
    userId,
    head: parsed.data.head,
  };
}
