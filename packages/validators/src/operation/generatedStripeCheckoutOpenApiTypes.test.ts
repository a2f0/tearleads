import { test } from "bun:test";
import type { StripeReturnUrlRequest } from "../request";
import type {
  ErrorResponse,
  StripeCancelResponse,
  StripeCheckoutIntentResponse,
  StripeCheckoutOptionsResponse,
  StripeCheckoutSessionResponse,
  StripePortalResponse,
} from "../response";
import type { operations, paths } from "./generatedOpenApi";

type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <
        Value,
      >() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;
type WithoutIndexSignatures<Value> = {
  [Key in keyof Value as string extends Key
    ? never
    : number extends Key
      ? never
      : symbol extends Key
        ? never
        : Key]: Value[Key];
};
type NormalizeWireType<Value> = Value extends readonly (infer Item)[]
  ? NormalizeWireType<Item>[]
  : Value extends object
    ? {
        [Key in keyof WithoutIndexSignatures<Value>]: NormalizeWireType<
          Exclude<WithoutIndexSignatures<Value>[Key], undefined>
        >;
      }
    : Value;

type OptionsOperation = operations["organizations.billing.stripe.options.get"];
type CheckoutOperation =
  operations["organizations.billing.stripe.checkout.create"];
type SessionOperation =
  operations["organizations.billing.stripe.checkoutSession.create"];
type PortalOperation = operations["organizations.billing.stripe.portal.create"];
type CancelOperation = operations["organizations.billing.stripe.cancel"];

type JsonRequest<Operation extends { requestBody: unknown }> =
  Operation["requestBody"] extends {
    content: { "application/json": infer Body };
  }
    ? Body
    : never;
type JsonResponse<
  Operation extends { responses: unknown },
  Status extends keyof Operation["responses"],
> = Operation["responses"][Status] extends {
  content: { "application/json": infer Body };
}
  ? Body
  : never;

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match Stripe checkout contracts", () => {
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/billing/stripe/options"]["get"],
      OptionsOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<OptionsOperation, 200>>,
      NormalizeWireType<StripeCheckoutOptionsResponse>
    >
  >();

  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<CheckoutOperation, 200>>,
      NormalizeWireType<StripeCheckoutIntentResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<CheckoutOperation, 503>>,
      NormalizeWireType<ErrorResponse>
    >
  >();

  assertType<
    IsEqual<
      NormalizeWireType<JsonRequest<SessionOperation>>,
      NormalizeWireType<StripeReturnUrlRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<SessionOperation, 200>>,
      NormalizeWireType<StripeCheckoutSessionResponse>
    >
  >();

  assertType<
    IsEqual<
      NormalizeWireType<JsonRequest<PortalOperation>>,
      NormalizeWireType<StripeReturnUrlRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<PortalOperation, 200>>,
      NormalizeWireType<StripePortalResponse>
    >
  >();

  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<CancelOperation, 200>>,
      NormalizeWireType<StripeCancelResponse>
    >
  >();
});
