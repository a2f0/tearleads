import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";
import {
  extractPaidInvoiceLineList,
  extractPaidSubscriptionInvoice,
  type StripePaidInvoiceLineSnapshot,
  type StripePaidSubscriptionInvoice,
} from "./stripeWebhook";

const INVOICE_LINE_PAGE_LIMIT = 100;
const INVOICE_LINE_MAX_PAGES = 100;

export type StripePaidSubscriptionInvoiceLookup =
  | {
      readonly status: "complete" | "line_details_unavailable";
      readonly invoice: StripePaidSubscriptionInvoice;
    }
  | { readonly status: "identity_mismatch" }
  | { readonly status: "invalid" };

async function getCompleteInvoiceLines(input: {
  readonly fetchImpl: typeof fetch;
  readonly invoiceId: string;
  readonly secretKey: string;
}): Promise<readonly StripePaidInvoiceLineSnapshot[] | null> {
  const encodedInvoiceId = encodeURIComponent(input.invoiceId);
  const lines: StripePaidInvoiceLineSnapshot[] = [];
  const cursors = new Set<string>();
  let startingAfter: string | null = null;

  for (
    let pageNumber = 0;
    pageNumber < INVOICE_LINE_MAX_PAGES;
    pageNumber += 1
  ) {
    const cursorQuery = startingAfter
      ? `&starting_after=${encodeURIComponent(startingAfter)}`
      : "";
    const body = await stripeRequest({
      fetchImpl: input.fetchImpl,
      secretKey: input.secretKey,
      method: "GET",
      path: `/v1/invoices/${encodedInvoiceId}/lines?limit=${INVOICE_LINE_PAGE_LIMIT}${cursorQuery}`,
      operation: "invoice line lookup",
    });
    const page = extractPaidInvoiceLineList(body);
    if (page.hasMore === null) {
      return null;
    }
    lines.push(...page.lines);
    if (!page.hasMore) {
      return lines;
    }
    const cursor = page.lines[page.lines.length - 1]?.id;
    if (!cursor || cursors.has(cursor)) {
      return null;
    }
    cursors.add(cursor);
    startingAfter = cursor;
  }
  return null;
}

/** Retrieves one invoice with the server-pinned Stripe API version. */
export async function getPaidSubscriptionInvoice(
  invoiceId: string,
  deps: StripeApiDeps = {},
  processingTime: Date = new Date(),
  expectedSubscriptionId?: string,
): Promise<StripePaidSubscriptionInvoiceLookup> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return { status: "invalid" };
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/invoices/${encodeURIComponent(invoiceId)}`,
    operation: "invoice lookup",
  });
  const invoice = extractPaidSubscriptionInvoice(
    {
      type: "invoice.paid",
      data: { object: body },
    },
    processingTime,
  );
  if (!invoice) {
    return { status: "invalid" };
  }
  if (
    invoice.invoiceId !== invoiceId ||
    (expectedSubscriptionId !== undefined &&
      invoice.subscriptionId !== expectedSubscriptionId)
  ) {
    return { status: "identity_mismatch" };
  }
  if (invoice.linesHasMore === false) {
    return { status: "complete", invoice };
  }
  const lines = await getCompleteInvoiceLines({
    fetchImpl,
    invoiceId,
    secretKey,
  });
  return lines
    ? {
        status: "complete",
        invoice: {
          ...invoice,
          lines,
          linesHasMore: false,
        },
      }
    : { status: "line_details_unavailable", invoice };
}
