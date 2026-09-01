import {
  escapeSearchValue,
  prop,
  readString,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";

const SEARCH_PAGE_SIZE = 100;
/** Bound provider work while still covering up to 10,000 subscriptions. */
const MAX_SEARCH_PAGES = 100;

interface StripeSubscriptionSearchRequest {
  readonly fetchImpl: typeof fetch;
  readonly secretKey: string;
}

function invalidSearchResponse(reason: string): never {
  throw new StripeApiError(`subscription search (${reason})`, 502);
}

function parseSearchPage(
  found: unknown,
  seenCursors: ReadonlySet<string>,
  isLastPage: boolean,
): { items: unknown[]; nextCursor: string | null } {
  const items = prop(found, "data");
  if (!Array.isArray(items)) {
    invalidSearchResponse("invalid data");
  }

  const hasMoreValue = prop(found, "has_more");
  if (typeof hasMoreValue !== "boolean") {
    invalidSearchResponse("invalid has_more");
  }
  if (hasMoreValue !== true) {
    return { items, nextCursor: null };
  }

  const nextCursor = readString(prop(found, "next_page"));
  if (!nextCursor) {
    invalidSearchResponse("missing next_page");
  }
  if (seenCursors.has(nextCursor)) {
    invalidSearchResponse("repeated next_page");
  }
  if (isLastPage) {
    invalidSearchResponse("page limit");
  }
  return { items, nextCursor };
}

/**
 * Visits every Stripe subscription search page until `match` finds a decisive
 * result. Pagination metadata is validated before a page's items are trusted.
 */
export async function findInStripeSubscriptionSearch<T>(
  organizationId: string,
  request: StripeSubscriptionSearchRequest,
  match: (item: unknown) => T | null,
): Promise<T | null> {
  const query = encodeURIComponent(
    `metadata['orgId']:'${escapeSearchValue(organizationId)}'`,
  );
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_SEARCH_PAGES; pageNumber += 1) {
    const pageParameter = cursor ? `&page=${encodeURIComponent(cursor)}` : "";
    const found = await stripeRequest({
      ...request,
      method: "GET",
      path:
        `/v1/subscriptions/search?query=${query}&limit=${SEARCH_PAGE_SIZE}` +
        pageParameter,
      operation: "subscription search",
    });
    const { items, nextCursor } = parseSearchPage(
      found,
      seenCursors,
      pageNumber === MAX_SEARCH_PAGES - 1,
    );

    for (const item of items) {
      const result = match(item);
      if (result !== null) {
        return result;
      }
    }
    if (!nextCursor) {
      return null;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return invalidSearchResponse("page limit");
}
