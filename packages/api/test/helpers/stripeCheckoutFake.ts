import { activeStripePrice } from "./stripeCatalog";

/**
 * A stateful fake of the Stripe endpoints checkout touches, for service tests
 * whose outcome depends on provider state carried across requests: one
 * customer, its subscriptions with their first invoices, and its hosted
 * Checkout Sessions. Creates honor idempotency keys as Stripe does, voiding
 * an invoice expires its incomplete subscription, and Stripe's refusals (an
 * invoice that is not open, a Session no longer open) are 400s.
 */

export interface FakeSubscription {
  readonly attemptId: string;
  readonly id: string;
  readonly invoiceId: string;
  readonly priceId: string;
  status: string;
}

export interface FakeSession {
  readonly attemptId: string;
  readonly created: number;
  readonly id: string;
  status: string;
}

interface FakeCreate {
  readonly form: URLSearchParams;
  readonly idempotencyKey: string;
  readonly path: string;
}

const PRICES: Readonly<Record<string, number>> = {
  price_sync: 500,
  price_team_5: 1_000,
  price_team_10: 2_000,
};

export function fakeStripeCheckout(organizationId: string, userId: string) {
  const subscriptions: FakeSubscription[] = [];
  const sessions: FakeSession[] = [];
  const creates: FakeCreate[] = [];
  const byKey = new Map<string, FakeSubscription | FakeSession>();

  const subscriptionBody = (sub: FakeSubscription) => ({
    id: sub.id,
    status: sub.status,
    customer: "cus_org",
    metadata: {
      checkoutAttemptId: sub.attemptId,
      orgId: organizationId,
      userId,
    },
    items: { data: [{ price: { id: sub.priceId }, quantity: 1 }] },
    latest_invoice: {
      id: sub.invoiceId,
      payment_intent: { client_secret: `${sub.id}_secret` },
    },
  });
  const sessionBody = (session: FakeSession) => ({
    id: session.id,
    created: session.created,
    status: session.status,
    metadata: { checkoutAttemptId: session.attemptId },
    url: `https://checkout.stripe.com/pay/${session.id}`,
  });
  const refuse = () => Response.json({ error: {} }, { status: 400 });
  const page = (data: unknown[]) => Response.json({ data, has_more: false });

  function create<T extends FakeSubscription | FakeSession>(
    request: Request,
    form: URLSearchParams,
    make: () => T,
  ): T {
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
    creates.push({
      form,
      idempotencyKey,
      path: new URL(request.url).pathname,
    });
    const existing = byKey.get(idempotencyKey) as T | undefined;
    if (existing) {
      return existing;
    }
    const made = make();
    byKey.set(idempotencyKey, made);
    return made;
  }

  function createSubscription(request: Request, form: URLSearchParams) {
    const sub = create(request, form, () => {
      const n = subscriptions.length + 1;
      const made: FakeSubscription = {
        attemptId: form.get("metadata[checkoutAttemptId]") ?? "",
        id: `sub_${n}`,
        invoiceId: `in_${n}`,
        priceId: form.get("items[0][price]") ?? "",
        status: "incomplete",
      };
      subscriptions.push(made);
      return made;
    });
    return Response.json(subscriptionBody(sub));
  }

  function createSession(request: Request, form: URLSearchParams) {
    const session = create(request, form, () => {
      const made: FakeSession = {
        attemptId: form.get("metadata[checkoutAttemptId]") ?? "",
        created: Math.floor(Date.now() / 1_000),
        id: `cs_${sessions.length + 1}`,
        status: "open",
      };
      sessions.push(made);
      return made;
    });
    return Response.json(sessionBody(session));
  }

  function invoice(invoiceId: string, action: string | undefined) {
    const sub = subscriptions.find((value) => value.invoiceId === invoiceId);
    if (action !== "void") {
      const status = sub?.status === "incomplete_expired" ? "void" : "open";
      return Response.json({ id: invoiceId, status });
    }
    if (sub?.status !== "incomplete") {
      return refuse();
    }
    sub.status = "incomplete_expired";
    return Response.json({ id: invoiceId, status: "void" });
  }

  function session(sessionId: string | undefined, action: string | undefined) {
    const found = sessions.find((value) => value.id === sessionId);
    if (!found) {
      return page(sessions.map(sessionBody));
    }
    if (action === "expire") {
      if (found.status !== "open") {
        return refuse();
      }
      found.status = "expired";
    }
    return Response.json(sessionBody(found));
  }

  async function respond(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const post = request.method === "POST";
    const form = new URLSearchParams(post ? await request.text() : "");
    const [, , resource, id, action] = pathname.split("/");
    if (resource === "prices" && id && PRICES[id]) {
      return Response.json(activeStripePrice(id, PRICES[id]));
    }
    if (resource === "customers") {
      return Response.json({ data: [{ id: "cus_org" }] });
    }
    if (resource === "subscriptions") {
      if (post) return createSubscription(request, form);
      const sub = subscriptions.find((value) => value.id === id);
      return sub
        ? Response.json(subscriptionBody(sub))
        : page(subscriptions.map(subscriptionBody));
    }
    if (resource === "invoices" && id) {
      return invoice(id, action);
    }
    if (resource === "checkout" && id === "sessions") {
      const [, , , , sessionId, sessionAction] = pathname.split("/");
      if (post && !sessionId) return createSession(request, form);
      return session(sessionId, sessionAction);
    }
    throw new Error(`Unexpected Stripe request: ${request.method} ${pathname}`);
  }

  return {
    creates,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new Request(input, init))) as typeof fetch,
    sessions,
    subscriptions,
    /** Checkouts the buyer could still pay: incomplete or open. */
    payable: () => [
      ...subscriptions.filter((sub) => sub.status === "incomplete"),
      ...sessions.filter((value) => value.status === "open"),
    ],
  };
}
