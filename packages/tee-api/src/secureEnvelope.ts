import { createHash, randomBytes, sign, verify } from 'node:crypto';
import {
  isJsonValue,
  isRecord,
  type JsonValue,
  stableStringify
} from './json.js';

export type TeeProofVersion = 'tee-proof.v1';
export type TeeProofAlgorithm = 'ed25519';
export type TeeTransport = 'tls' | 'loopback';

export interface TeeAttestationEvidence {
  provider: string;
  quoteSha256: string;
}

export interface TeeProofPayload {
  version: TeeProofVersion;
  algorithm: TeeProofAlgorithm;
  keyId: string;
  requestNonce: string;
  requestDigest: string;
  responseDigest: string;
  transport: TeeTransport;
  issuedAt: string;
  expiresAt: string;
  attestation?: TeeAttestationEvidence;
}

export interface TeeResponseProof extends TeeProofPayload {
  signature: string;
}

export interface TeeSecureEnvelope<TData extends JsonValue> {
  data: TData;
  proof: TeeResponseProof;
}

interface ComputeRequestDigestInput {
  method: string;
  path: string;
  requestNonce: string;
  body: JsonValue | undefined;
}

interface ComputeResponseDigestInput {
  status: number;
  body: JsonValue;
}

export interface CreateTeeSecureEnvelopeInput<TData extends JsonValue> {
  data: TData;
  method: string;
  path: string;
  requestNonce: string;
  requestBody: JsonValue | undefined;
  responseStatus: number;
  keyId: string;
  privateKeyPem: string;
  transport: TeeTransport;
  ttlSeconds?: number;
  now?: Date;
  attestation?: TeeAttestationEvidence;
}

export type TeeVerificationFailureCode =
  | 'invalid_signature'
  | 'request_digest_mismatch'
  | 'response_digest_mismatch'
  | 'missing_trusted_key'
  | 'transport_mismatch'
  | 'invalid_timestamps'
  | 'stale_or_future_proof'
  | 'missing_required_attestation'
  | 'untrusted_attestation_provider'
  | 'attestation_quote_mismatch';

export interface TeeAttestationPolicy {
  trustedProviders?: string[];
  expectedQuoteSha256s?: Record<string, string>;
  requireAttestation?: boolean;
}

export interface VerifyTeeSecureEnvelopeInput<TData extends JsonValue> {
  envelope: TeeSecureEnvelope<TData>;
  method: string;
  path: string;
  requestNonce: string;
  requestBody: JsonValue | undefined;
  responseStatus: number;
  trustedPublicKeys: Record<string, string>;
  expectedTransport?: TeeTransport;
  now?: Date;
  maxClockSkewSeconds?: number;
  attestationPolicy?: TeeAttestationPolicy;
}

export interface TeeVerificationResult {
  signatureValid: boolean;
  requestDigestMatches: boolean;
  responseDigestMatches: boolean;
  freshnessValid: boolean;
  transportMatches: boolean;
  attestationValid: boolean;
  failureCodes: TeeVerificationFailureCode[];
  isValid: boolean;
}

const PROOF_VERSION: TeeProofVersion = 'tee-proof.v1';
const PROOF_ALGORITHM: TeeProofAlgorithm = 'ed25519';

function hashBase64Url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function addFailure(
  target: TeeVerificationFailureCode[],
  code: TeeVerificationFailureCode
): void {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function isTransport(value: string): value is TeeTransport {
  return value === 'tls' || value === 'loopback';
}

function parseDateMillis(value: string): number | undefined {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

export function createRequestNonce(byteLength = 18): string {
  if (byteLength < 16) {
    throw new Error('byteLength must be at least 16 bytes');
  }
  return randomBytes(byteLength).toString('base64url');
}

export function computeRequestDigest(input: ComputeRequestDigestInput): string {
  if (input.requestNonce.length === 0) {
    throw new Error('requestNonce must be non-empty');
  }

  const normalizedBody = input.body ?? null;
  const bodyDigest = hashBase64Url(stableStringify(normalizedBody));
  const canonical = `${normalizeMethod(input.method)}\n${input.path}\n${input.requestNonce}\n${bodyDigest}`;

  return hashBase64Url(canonical);
}

export function computeResponseDigest(
  input: ComputeResponseDigestInput
): string {
  const bodyDigest = hashBase64Url(stableStringify(input.body));
  return hashBase64Url(`${input.status}\n${bodyDigest}`);
}

export function canonicalizeTeeProofPayload(payload: TeeProofPayload): string {
  const attestationProvider = payload.attestation?.provider ?? '';
  const attestationQuoteSha256 = payload.attestation?.quoteSha256 ?? '';

  return [
    payload.version,
    payload.algorithm,
    payload.keyId,
    payload.requestNonce,
    payload.requestDigest,
    payload.responseDigest,
    payload.transport,
    payload.issuedAt,
    payload.expiresAt,
    attestationProvider,
    attestationQuoteSha256
  ].join('\n');
}

export function createTeeSecureEnvelope<TData extends JsonValue>(
  input: CreateTeeSecureEnvelopeInput<TData>
): TeeSecureEnvelope<TData> {
  if (input.requestNonce.length === 0) {
    throw new Error('requestNonce must be non-empty');
  }

  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 30;

  if (ttlSeconds <= 0 || !Number.isFinite(ttlSeconds)) {
    throw new Error('ttlSeconds must be a positive number');
  }

  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const payloadBase = {
    version: PROOF_VERSION,
    algorithm: PROOF_ALGORITHM,
    keyId: input.keyId,
    requestNonce: input.requestNonce,
    requestDigest: computeRequestDigest({
      method: input.method,
      path: input.path,
      requestNonce: input.requestNonce,
      body: input.requestBody
    }),
    responseDigest: computeResponseDigest({
      status: input.responseStatus,
      body: input.data
    }),
    transport: input.transport,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  const payload: TeeProofPayload =
    input.attestation === undefined
      ? payloadBase
      : {
          ...payloadBase,
          attestation: input.attestation
        };

  const payloadForSignature = canonicalizeTeeProofPayload(payload);
  const signature = sign(
    null,
    Buffer.from(payloadForSignature, 'utf8'),
    input.privateKeyPem
  ).toString('base64url');

  return {
    data: input.data,
    proof: {
      ...payload,
      signature
    }
  };
}

export function verifyTeeSecureEnvelope<TData extends JsonValue>(
  input: VerifyTeeSecureEnvelopeInput<TData>
): TeeVerificationResult {
  const failureCodes: TeeVerificationFailureCode[] = [];
  const proof = input.envelope.proof;

  const expectedRequestDigest = computeRequestDigest({
    method: input.method,
    path: input.path,
    requestNonce: input.requestNonce,
    body: input.requestBody
  });
  const requestDigestMatches = expectedRequestDigest === proof.requestDigest;
  if (!requestDigestMatches) {
    addFailure(failureCodes, 'request_digest_mismatch');
  }

  const expectedResponseDigest = computeResponseDigest({
    status: input.responseStatus,
    body: input.envelope.data
  });
  const responseDigestMatches = expectedResponseDigest === proof.responseDigest;
  if (!responseDigestMatches) {
    addFailure(failureCodes, 'response_digest_mismatch');
  }

  const trustedPublicKey = input.trustedPublicKeys[proof.keyId];
  let signatureValid = false;

  if (trustedPublicKey === undefined) {
    addFailure(failureCodes, 'missing_trusted_key');
  } else {
    const signedPayloadBase = {
      version: proof.version,
      algorithm: proof.algorithm,
      keyId: proof.keyId,
      requestNonce: proof.requestNonce,
      requestDigest: proof.requestDigest,
      responseDigest: proof.responseDigest,
      transport: proof.transport,
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt
    };
    const signedPayload = canonicalizeTeeProofPayload(
      proof.attestation === undefined
        ? signedPayloadBase
        : {
            ...signedPayloadBase,
            attestation: proof.attestation
          }
    );

    try {
      signatureValid = verify(
        null,
        Buffer.from(signedPayload, 'utf8'),
        trustedPublicKey,
        Buffer.from(proof.signature, 'base64url')
      );
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      addFailure(failureCodes, 'invalid_signature');
    }
  }

  let freshnessValid = true;
  const now = input.now ?? new Date();
  const maxClockSkewSeconds = input.maxClockSkewSeconds ?? 5;
  const issuedAtMillis = parseDateMillis(proof.issuedAt);
  const expiresAtMillis = parseDateMillis(proof.expiresAt);

  if (
    issuedAtMillis === undefined ||
    expiresAtMillis === undefined ||
    expiresAtMillis < issuedAtMillis
  ) {
    freshnessValid = false;
    addFailure(failureCodes, 'invalid_timestamps');
  } else {
    const nowMillis = now.getTime();
    const skewMillis = maxClockSkewSeconds * 1000;
    const isTooEarly = nowMillis + skewMillis < issuedAtMillis;
    const isExpired = nowMillis - skewMillis > expiresAtMillis;

    if (isTooEarly || isExpired) {
      freshnessValid = false;
      addFailure(failureCodes, 'stale_or_future_proof');
    }
  }

  const transportMatches =
    input.expectedTransport === undefined ||
    input.expectedTransport === proof.transport;

  if (!transportMatches) {
    addFailure(failureCodes, 'transport_mismatch');
  }

  let attestationValid = true;
  const policy = input.attestationPolicy;
  const attestation = proof.attestation;

  if (policy !== undefined) {
    if (policy.requireAttestation === true && attestation === undefined) {
      attestationValid = false;
      addFailure(failureCodes, 'missing_required_attestation');
    }

    if (attestation !== undefined) {
      if (
        policy.trustedProviders !== undefined &&
        !policy.trustedProviders.includes(attestation.provider)
      ) {
        attestationValid = false;
        addFailure(failureCodes, 'untrusted_attestation_provider');
      }

      if (policy.expectedQuoteSha256s !== undefined) {
        const expectedQuote = policy.expectedQuoteSha256s[attestation.provider];
        if (
          expectedQuote !== undefined &&
          expectedQuote !== attestation.quoteSha256
        ) {
          attestationValid = false;
          addFailure(failureCodes, 'attestation_quote_mismatch');
        }
      }
    }
  }

  return {
    signatureValid,
    requestDigestMatches,
    responseDigestMatches,
    freshnessValid,
    transportMatches,
    attestationValid,
    failureCodes,
    isValid: failureCodes.length === 0
  };
}

function parseTeeAttestation(
  value: unknown
): TeeAttestationEvidence | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('proof.attestation must be an object');
  }

  const provider = value['provider'];
  const quoteSha256 = value['quoteSha256'];

  if (typeof provider !== 'string' || typeof quoteSha256 !== 'string') {
    throw new Error('proof.attestation fields must be strings');
  }

  return {
    provider,
    quoteSha256
  };
}

function parseTeeProof(value: unknown): TeeResponseProof {
  if (!isRecord(value)) {
    throw new Error('proof must be an object');
  }

  const version = value['version'];
  const algorithm = value['algorithm'];
  const keyId = value['keyId'];
  const requestNonce = value['requestNonce'];
  const requestDigest = value['requestDigest'];
  const responseDigest = value['responseDigest'];
  const transport = value['transport'];
  const issuedAt = value['issuedAt'];
  const expiresAt = value['expiresAt'];
  const signature = value['signature'];

  if (version !== PROOF_VERSION) {
    throw new Error(`Unsupported proof version: ${String(version)}`);
  }

  if (algorithm !== PROOF_ALGORITHM) {
    throw new Error(`Unsupported proof algorithm: ${String(algorithm)}`);
  }

  if (
    typeof keyId !== 'string' ||
    typeof requestNonce !== 'string' ||
    typeof requestDigest !== 'string' ||
    typeof responseDigest !== 'string' ||
    typeof issuedAt !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof signature !== 'string'
  ) {
    throw new Error('proof fields are invalid');
  }

  if (typeof transport !== 'string' || !isTransport(transport)) {
    throw new Error('proof.transport must be "tls" or "loopback"');
  }

  const attestation = parseTeeAttestation(value['attestation']);

  const proofBase = {
    version,
    algorithm,
    keyId,
    requestNonce,
    requestDigest,
    responseDigest,
    transport,
    issuedAt,
    expiresAt,
    signature
  };

  return attestation === undefined
    ? proofBase
    : {
        ...proofBase,
        attestation
      };
}

export function parseTeeSecureEnvelope(
  value: unknown
): TeeSecureEnvelope<JsonValue> {
  if (!isRecord(value)) {
    throw new Error('Envelope must be an object');
  }

  const data = value['data'];
  if (!isJsonValue(data)) {
    throw new Error('Envelope data must be valid JSON');
  }

  const proof = parseTeeProof(value['proof']);

  return {
    data,
    proof
  };
}
