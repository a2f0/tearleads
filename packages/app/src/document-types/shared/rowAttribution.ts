// The bare writer token for an attribution: "you" when the writer is the local
// signer, a shortened id for anyone else, or null when there is no writer (an
// unresolved peer, or a row/cell written unauthenticated).
export function formatWriterLabel(
  writerUserId: string | null,
  currentAuthorId: string | null,
): string | null {
  const author = (writerUserId ?? "").trim();
  if (author.length === 0) {
    return null;
  }
  return author === currentAuthorId ? "you" : shortAuthorId(author);
}

// "<time> by <who>" — or just "<time>" when the writer is unknown — or null when
// there is no timestamp. The verb ("Updated"/"Created") is supplied by the
// caller (or the surrounding label), so this stays reusable.
export function formatRowByline(params: {
  currentAuthorId: string | null;
  at: string;
  by: string;
}): string | null {
  const when = params.at.trim();
  if (when.length === 0) {
    return null;
  }

  // Trim the ISO timestamp to minute precision, e.g. "2026-07-16 08:30".
  const readableWhen = when.replace("T", " ").slice(0, 16);
  const who = formatWriterLabel(params.by, params.currentAuthorId);
  return who === null ? readableWhen : `${readableWhen} by ${who}`;
}

// Render a row's "who last edited this, and when" line from its stored
// attribution: "Updated 2026-07-16 08:30 by you", or null when the row predates
// attribution.
export function formatRowAttribution(params: {
  currentAuthorId: string | null;
  updatedAt: string;
  updatedBy: string;
}): string | null {
  const byline = formatRowByline({
    at: params.updatedAt,
    by: params.updatedBy,
    currentAuthorId: params.currentAuthorId,
  });
  return byline === null ? null : `Updated ${byline}`;
}

function shortAuthorId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
