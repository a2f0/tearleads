import { toFingerprint } from "@tearleads/crypto";
import type {
  AccessLevel,
  RecipientPrincipalType,
} from "./recipientPrincipals";

const textEncoder = new TextEncoder();

export type AccessFingerprintRecipient = {
  readonly accessLevel: AccessLevel;
  readonly keyFingerprint: string;
  readonly principalId: string;
  readonly principalType: RecipientPrincipalType;
};

export type ContainerAccessFingerprintGrant = {
  readonly accessLevel: string;
  readonly objectId: string;
  readonly subjectId: string;
  readonly subjectType: string;
};

export type DocumentAccessFingerprintGrant = {
  readonly accessLevel: string;
  readonly subjectId: string;
  readonly subjectType: string;
};

export type ContainerAccessFingerprintPayload = {
  readonly objectType: "container";
  readonly ancestorContainerIds: readonly string[];
  readonly containerId: string;
  readonly grants: readonly ContainerAccessFingerprintGrant[];
  readonly recipients: readonly AccessFingerprintRecipient[];
};

export type DocumentAccessFingerprintPayload = {
  readonly objectType: "document";
  readonly documentId: string;
  readonly grants: readonly DocumentAccessFingerprintGrant[];
  readonly linkedContainerFingerprints: readonly string[];
  readonly linkedContainerIds: readonly string[];
  readonly recipients: readonly AccessFingerprintRecipient[];
};

export type BlobAccessFingerprintPayload = {
  readonly objectType: "blob";
  readonly blobId: string;
  readonly linkedDocumentFingerprints: readonly string[];
  readonly linkedDocumentIds: readonly string[];
  readonly recipients: readonly AccessFingerprintRecipient[];
};

export type AccessFingerprintPayload =
  | BlobAccessFingerprintPayload
  | ContainerAccessFingerprintPayload
  | DocumentAccessFingerprintPayload;

type AccessStateReferencedPrincipal = {
  readonly keyEpoch: number;
  readonly principalId: string;
  readonly principalType: "group" | "organization";
  readonly stateHash: string;
  readonly version: number;
};

type DocumentAccessStateLink = {
  readonly accessStateHash: string;
  readonly containerId: string;
};

type BlobAccessStateLink = {
  readonly accessStateHash: string;
  readonly documentId: string;
};

type ContainerAccessStateHashPayload = {
  readonly objectType: "container";
  readonly ancestorContainerIds: readonly string[];
  readonly containerId: string;
  readonly grants: readonly ContainerAccessFingerprintGrant[];
  readonly referencedPrincipals: readonly AccessStateReferencedPrincipal[];
};

type DocumentAccessStateHashPayload = {
  readonly objectType: "document";
  readonly documentId: string;
  readonly grants: readonly DocumentAccessFingerprintGrant[];
  readonly linkedContainers: readonly DocumentAccessStateLink[];
};

type BlobAccessStateHashPayload = {
  readonly objectType: "blob";
  readonly blobId: string;
  readonly linkedDocuments: readonly BlobAccessStateLink[];
};

type AccessStateHashPayload =
  | BlobAccessStateHashPayload
  | ContainerAccessStateHashPayload
  | DocumentAccessStateHashPayload;

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: object,
  expectedKeys: readonly string[],
  label: string,
) {
  if (!isPlainObject(value)) {
    throw new TypeError(`Access fingerprint ${label} must be a plain object`);
  }

  const actualKeys = [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value).map(String),
  ].sort();

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(
      `Access fingerprint ${label} has unexpected keys: ${actualKeys.join(",")}`,
    );
  }
}

function stringifyCanonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Access fingerprint payload contains a non-finite number",
      );
    }

    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    const items: string[] = [];

    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(
          "Access fingerprint payload contains a sparse array",
        );
      }

      items.push(stringifyCanonicalJson(value[index]));
    }

    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new TypeError(
        "Access fingerprint payload contains a non-plain object",
      );
    }

    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stringifyCanonicalJson(record[key])}`,
      )
      .join(",")}}`;
  }

  throw new TypeError(
    `Access fingerprint payload contains unsupported value type: ${typeof value}`,
  );
}

function compareCanonicalJson(left: unknown, right: unknown): number {
  const leftJson = stringifyCanonicalJson(left);
  const rightJson = stringifyCanonicalJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function sortCanonicalJsonArray<T>(values: readonly T[]): T[] {
  return [...values].sort(compareCanonicalJson);
}

function normalizeRecipient(
  recipient: AccessFingerprintRecipient,
): AccessFingerprintRecipient {
  assertExactKeys(
    recipient,
    ["accessLevel", "keyFingerprint", "principalId", "principalType"],
    "recipient",
  );

  return {
    accessLevel: recipient.accessLevel,
    keyFingerprint: recipient.keyFingerprint,
    principalId: recipient.principalId,
    principalType: recipient.principalType,
  };
}

function normalizeContainerGrant(
  grant: ContainerAccessFingerprintGrant,
): ContainerAccessFingerprintGrant {
  assertExactKeys(
    grant,
    ["accessLevel", "objectId", "subjectId", "subjectType"],
    "container grant",
  );

  return {
    accessLevel: grant.accessLevel,
    objectId: grant.objectId,
    subjectId: grant.subjectId,
    subjectType: grant.subjectType,
  };
}

function normalizeDocumentGrant(
  grant: DocumentAccessFingerprintGrant,
): DocumentAccessFingerprintGrant {
  assertExactKeys(
    grant,
    ["accessLevel", "subjectId", "subjectType"],
    "document grant",
  );

  return {
    accessLevel: grant.accessLevel,
    subjectId: grant.subjectId,
    subjectType: grant.subjectType,
  };
}

function normalizeReferencedPrincipal(
  principal: AccessStateReferencedPrincipal,
): AccessStateReferencedPrincipal {
  assertExactKeys(
    principal,
    ["keyEpoch", "principalId", "principalType", "stateHash", "version"],
    "referenced principal",
  );

  return {
    keyEpoch: principal.keyEpoch,
    principalId: principal.principalId,
    principalType: principal.principalType,
    stateHash: principal.stateHash,
    version: principal.version,
  };
}

function normalizeDocumentAccessStateLink(
  link: DocumentAccessStateLink,
): DocumentAccessStateLink {
  assertExactKeys(
    link,
    ["accessStateHash", "containerId"],
    "document access-state link",
  );

  return {
    accessStateHash: link.accessStateHash,
    containerId: link.containerId,
  };
}

function normalizeBlobAccessStateLink(
  link: BlobAccessStateLink,
): BlobAccessStateLink {
  assertExactKeys(
    link,
    ["accessStateHash", "documentId"],
    "blob access-state link",
  );

  return {
    accessStateHash: link.accessStateHash,
    documentId: link.documentId,
  };
}

function normalizeAccessFingerprintPayload(
  value: AccessFingerprintPayload,
): AccessFingerprintPayload {
  if (value.objectType === "container") {
    assertExactKeys(
      value,
      [
        "ancestorContainerIds",
        "containerId",
        "grants",
        "objectType",
        "recipients",
      ],
      "container payload",
    );

    return {
      objectType: "container",
      ancestorContainerIds: value.ancestorContainerIds,
      containerId: value.containerId,
      grants: sortCanonicalJsonArray(value.grants.map(normalizeContainerGrant)),
      recipients: sortCanonicalJsonArray(
        value.recipients.map(normalizeRecipient),
      ),
    };
  }

  if (value.objectType === "document") {
    assertExactKeys(
      value,
      [
        "documentId",
        "grants",
        "linkedContainerFingerprints",
        "linkedContainerIds",
        "objectType",
        "recipients",
      ],
      "document payload",
    );

    return {
      objectType: "document",
      documentId: value.documentId,
      grants: sortCanonicalJsonArray(value.grants.map(normalizeDocumentGrant)),
      linkedContainerFingerprints: value.linkedContainerFingerprints,
      linkedContainerIds: value.linkedContainerIds,
      recipients: sortCanonicalJsonArray(
        value.recipients.map(normalizeRecipient),
      ),
    };
  }

  assertExactKeys(
    value,
    [
      "blobId",
      "linkedDocumentFingerprints",
      "linkedDocumentIds",
      "objectType",
      "recipients",
    ],
    "blob payload",
  );

  return {
    objectType: "blob",
    blobId: value.blobId,
    linkedDocumentFingerprints: value.linkedDocumentFingerprints,
    linkedDocumentIds: value.linkedDocumentIds,
    recipients: sortCanonicalJsonArray(
      value.recipients.map(normalizeRecipient),
    ),
  };
}

function normalizeAccessStateHashPayload(
  value: AccessStateHashPayload,
): AccessStateHashPayload {
  if (value.objectType === "container") {
    assertExactKeys(
      value,
      [
        "ancestorContainerIds",
        "containerId",
        "grants",
        "objectType",
        "referencedPrincipals",
      ],
      "container state-hash payload",
    );

    return {
      objectType: "container",
      ancestorContainerIds: value.ancestorContainerIds,
      containerId: value.containerId,
      grants: sortCanonicalJsonArray(value.grants.map(normalizeContainerGrant)),
      referencedPrincipals: sortCanonicalJsonArray(
        value.referencedPrincipals.map(normalizeReferencedPrincipal),
      ),
    };
  }

  if (value.objectType === "document") {
    assertExactKeys(
      value,
      ["documentId", "grants", "linkedContainers", "objectType"],
      "document state-hash payload",
    );

    return {
      objectType: "document",
      documentId: value.documentId,
      grants: sortCanonicalJsonArray(value.grants.map(normalizeDocumentGrant)),
      linkedContainers: sortCanonicalJsonArray(
        value.linkedContainers.map(normalizeDocumentAccessStateLink),
      ),
    };
  }

  assertExactKeys(
    value,
    ["blobId", "linkedDocuments", "objectType"],
    "blob state-hash payload",
  );

  return {
    objectType: "blob",
    blobId: value.blobId,
    linkedDocuments: sortCanonicalJsonArray(
      value.linkedDocuments.map(normalizeBlobAccessStateLink),
    ),
  };
}

export async function computeAccessFingerprint(
  value: AccessFingerprintPayload,
): Promise<string> {
  return toFingerprint(
    textEncoder.encode(
      stringifyCanonicalJson(normalizeAccessFingerprintPayload(value)),
    ),
  );
}

export async function computeAccessStateHash(
  value: AccessStateHashPayload,
): Promise<string> {
  return toFingerprint(
    textEncoder.encode(
      stringifyCanonicalJson(normalizeAccessStateHashPayload(value)),
    ),
  );
}
