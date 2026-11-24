/**
 * Rows per insert statement for the rows a document write adds per peer: a
 * span row for each peer of each accepted update, and an owner row for each
 * peer the write claims. A request names as many peers as its byte ceiling
 * admits, and Postgres binds at most 65,535 parameters to a statement, so a
 * single statement holds at most 13,107 five-column span rows. 8,192 rows of
 * up to seven bound columns stay under that limit; eight would bind 65,536.
 */
const DOCUMENT_PEER_ROWS_PER_INSERT = 8_192;

/** `rows` in order, cut into statement-sized chunks. */
export function chunkDocumentPeerRows<Row>(rows: readonly Row[]): Row[][] {
  const chunks: Row[][] = [];
  for (
    let start = 0;
    start < rows.length;
    start += DOCUMENT_PEER_ROWS_PER_INSERT
  ) {
    chunks.push(rows.slice(start, start + DOCUMENT_PEER_ROWS_PER_INSERT));
  }
  return chunks;
}
