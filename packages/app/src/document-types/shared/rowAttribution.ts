// Render a row's "who last edited this, and when" line from its stored
// attribution. The stored author is a signing user id; show "you" when it is
// the local writer, a shortened id for anyone else, and omit authorship
// entirely when the row predates attribution or was written unauthenticated.
export function formatRowAttribution(params: {
  currentAuthorId: string | null;
  updatedAt: string;
  updatedBy: string;
}): string | null {
  const when = params.updatedAt.trim();
  if (when.length === 0) {
    return null;
  }

  // Trim the ISO timestamp to minute precision, e.g. "2026-07-16 08:30".
  const readableWhen = when.replace("T", " ").slice(0, 16);
  const author = params.updatedBy.trim();
  if (author.length === 0) {
    return `Updated ${readableWhen}`;
  }

  const who = author === params.currentAuthorId ? "you" : shortAuthorId(author);
  return `Updated ${readableWhen} by ${who}`;
}

function shortAuthorId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
