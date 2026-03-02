import { parseBooleanEnv } from './parseBooleanEnv.js';

const LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG =
  'VFS_CRDT_PROTOBUF_INCLUDE_LEGACY_ENVELOPE_STRINGS';

export function shouldIncludeLegacyCrdtProtobufEnvelopeStrings(): boolean {
  return parseBooleanEnv(
    process.env[LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG],
    false
  );
}
