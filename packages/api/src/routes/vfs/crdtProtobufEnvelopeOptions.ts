const LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG =
  'VFS_CRDT_PROTOBUF_INCLUDE_LEGACY_ENVELOPE_STRINGS';

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function shouldIncludeLegacyCrdtProtobufEnvelopeStrings(): boolean {
  return parseBooleanEnv(
    process.env[LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG],
    false
  );
}
