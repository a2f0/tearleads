interface PrfExtensionResults {
  readonly enabled?: boolean | undefined;
  readonly results?:
    | {
        readonly first?: BufferSource | undefined;
      }
    | undefined;
}

interface PasskeyPublicKeyCredential {
  readonly rawId: ArrayBuffer;
  readonly response: unknown;
  readonly prf: () => PrfExtensionResults | undefined;
}

interface PasskeyAttestationMetadata {
  readonly publicKey: ArrayBuffer;
  readonly publicKeyAlgorithm: number;
  readonly transports: readonly string[];
}

export function asArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function readPublicKeyCredential(
  credential: Credential | null,
  label: string,
): PasskeyPublicKeyCredential {
  const rawId = credential ? Reflect.get(credential, "rawId") : null;
  const response = credential ? Reflect.get(credential, "response") : null;
  const getClientExtensionResults = credential
    ? Reflect.get(credential, "getClientExtensionResults")
    : null;
  if (
    !credential ||
    credential.type !== "public-key" ||
    !(rawId instanceof ArrayBuffer) ||
    typeof getClientExtensionResults !== "function"
  ) {
    throw new Error(`${label} did not return a public-key credential.`);
  }

  return {
    rawId,
    response,
    prf: () =>
      readPrfExtensionResults(getClientExtensionResults.call(credential)),
  };
}

export function readAttestationMetadata(
  response: unknown,
): PasskeyAttestationMetadata {
  const getPublicKey =
    response && typeof response === "object"
      ? Reflect.get(response, "getPublicKey")
      : null;
  const getPublicKeyAlgorithm =
    response && typeof response === "object"
      ? Reflect.get(response, "getPublicKeyAlgorithm")
      : null;
  if (
    !response ||
    typeof getPublicKey !== "function" ||
    typeof getPublicKeyAlgorithm !== "function"
  ) {
    throw new Error(
      "Passkey backup credential did not expose public credential metadata.",
    );
  }

  const publicKey = getPublicKey.call(response);
  const publicKeyAlgorithm = getPublicKeyAlgorithm.call(response);
  if (!(publicKey instanceof ArrayBuffer)) {
    throw new Error("Passkey credential public key is unavailable.");
  }
  if (!Number.isInteger(publicKeyAlgorithm)) {
    throw new Error("Passkey credential public key algorithm is invalid.");
  }

  return {
    publicKey,
    publicKeyAlgorithm,
    transports: readCredentialTransports(response),
  };
}

function readCredentialTransports(response: object): string[] {
  const getTransports = Reflect.get(response, "getTransports");
  if (typeof getTransports !== "function") {
    return [];
  }

  const transports = getTransports.call(response);
  if (!Array.isArray(transports)) {
    return [];
  }

  return transports.filter(
    (transport) => typeof transport === "string" && transport.length > 0,
  );
}

function bytesFromBufferSource(source: BufferSource): Uint8Array<ArrayBuffer> {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  }

  return asArrayBufferBytes(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );
}

function isBufferSource(value: unknown): value is BufferSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function readPrfExtensionResults(
  value: unknown,
): PrfExtensionResults | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const prf = Reflect.get(value, "prf");
  if (!prf || typeof prf !== "object") {
    return undefined;
  }

  const enabled = Reflect.get(prf, "enabled");
  const results = Reflect.get(prf, "results");
  const first =
    results && typeof results === "object"
      ? Reflect.get(results, "first")
      : null;

  return {
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(isBufferSource(first) ? { results: { first } } : {}),
  };
}

export function readPrfOutput(
  prf: PrfExtensionResults | undefined,
): Uint8Array<ArrayBuffer> | null {
  const first = prf?.results?.first;
  return first ? bytesFromBufferSource(first) : null;
}
