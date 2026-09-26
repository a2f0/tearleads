import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { normalizeDocumentBlobRewraps } from "./documentBlobRewraps";
import {
  assertExactKeys,
  readHashString,
  readString,
  throwVerification,
} from "./shared";
import type {
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentUnlinkAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

function normalizeDocumentLinkAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentLinkAccessEventBody {
  const record = assertExactKeys(
    value,
    ["blobRewraps", "containerId", "containerManifestHash", "eventType"],
    "document.link event body",
  );

  return {
    eventType: "document.link",
    blobRewraps: normalizeDocumentBlobRewraps(record.blobRewraps),
    containerId: readString(record, "containerId", "document.link event body"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.link event body",
    ),
  };
}

function normalizeDocumentUnlinkAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentUnlinkAccessEventBody {
  const record = assertExactKeys(
    value,
    ["blobRewraps", "containerId", "containerManifestHash", "eventType"],
    "document.unlink event body",
  );

  return {
    eventType: "document.unlink",
    blobRewraps: normalizeDocumentBlobRewraps(record.blobRewraps),
    containerId: readString(
      record,
      "containerId",
      "document.unlink event body",
    ),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.unlink event body",
    ),
  };
}

export function normalizeDocumentAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "document access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "document access body");

  if (eventType === "document.link") {
    return normalizeDocumentLinkAccessEventBody(value);
  }

  if (eventType === "document.unlink") {
    return normalizeDocumentUnlinkAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "document access event body eventType is unsupported",
  );
}
