import { test } from "bun:test";
import type {
  RevenueCatWebhookRequest,
  StripeWebhookRequest,
} from "../request";
import type {
  ErrorResponse,
  RevenueCatWebhookResponse,
  StripeWebhookResponse,
} from "../response";
import type {
  RevenueCatWebhookHeaders,
  StripeWebhookHeaders,
} from "./billingWebhooks";
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

type RevenueCatOperation = operations["billing.revenuecat.webhook.receive"];
type StripeOperation = operations["billing.stripe.webhook.receive"];
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

test("generated OpenAPI types match billing webhook contracts", () => {
  assertType<
    IsEqual<paths["/billing/revenuecat/webhook"]["post"], RevenueCatOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonRequest<RevenueCatOperation>>,
      NormalizeWireType<RevenueCatWebhookRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<
        NonNullable<RevenueCatOperation["parameters"]["header"]>
      >,
      NormalizeWireType<RevenueCatWebhookHeaders>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<RevenueCatOperation, 200>>,
      NormalizeWireType<RevenueCatWebhookResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<RevenueCatOperation, 400>>,
      NormalizeWireType<ErrorResponse>
    >
  >();

  assertType<
    IsEqual<paths["/billing/stripe/webhook"]["post"], StripeOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonRequest<StripeOperation>>,
      NormalizeWireType<StripeWebhookRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<NonNullable<StripeOperation["parameters"]["header"]>>,
      NormalizeWireType<StripeWebhookHeaders>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<JsonResponse<StripeOperation, 200>>,
      NormalizeWireType<StripeWebhookResponse>
    >
  >();
});
