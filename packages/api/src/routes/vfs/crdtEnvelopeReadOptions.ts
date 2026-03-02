import { parseBooleanEnv } from './parseBooleanEnv.js';

const ENVELOPE_BYTEA_READS_FLAG = 'VFS_CRDT_ENVELOPE_BYTEA_READS';

export function shouldReadEnvelopeBytea(): boolean {
  return parseBooleanEnv(process.env[ENVELOPE_BYTEA_READS_FLAG], true);
}
