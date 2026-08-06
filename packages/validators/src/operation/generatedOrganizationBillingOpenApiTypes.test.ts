import { test } from "bun:test";
import type { NativeSubscriptionStore } from "../billing";
import type {
  ErrorResponse,
  OrganizationBillingHistoryResponse,
  OrganizationBillingManagementUrlResponse,
  OrganizationBillingResponse,
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

type BillingOperation = operations["organizations.billing.get"];
type BillingResponse =
  BillingOperation["responses"][200]["content"]["application/json"];
type HistoryOperation = operations["organizations.billing.history.get"];
type HistoryResponse =
  HistoryOperation["responses"][200]["content"]["application/json"];
type ManagementOperation =
  operations["organizations.billing.managementUrl.get"];
type ManagementResponse =
  ManagementOperation["responses"][200]["content"]["application/json"];
type NativeClaimOperation = operations["organizations.billing.native.claim"];
type NativeClaimPathParams = NativeClaimOperation["parameters"]["path"];
type NativeClaimResponse =
  NativeClaimOperation["responses"][200]["content"]["application/json"];
type NativeClaimUnavailableResponse =
  NativeClaimOperation["responses"][503]["content"]["application/json"];
type TrialOperation = operations["organizations.billing.trial.start"];
type TrialResponse =
  TrialOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match organization billing contracts", () => {
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/billing"]["get"],
      BillingOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<BillingResponse>,
      NormalizeWireType<OrganizationBillingResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/billing/history"]["get"],
      HistoryOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<HistoryResponse>,
      NormalizeWireType<OrganizationBillingHistoryResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/billing/management-url"]["get"],
      ManagementOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<ManagementResponse>,
      NormalizeWireType<OrganizationBillingManagementUrlResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/billing/native/{store}/claim"]["post"],
      NativeClaimOperation
    >
  >();
  assertType<
    IsEqual<
      NativeClaimPathParams,
      { organizationId: string; store: NativeSubscriptionStore }
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<NativeClaimResponse>,
      NormalizeWireType<OrganizationBillingResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<NativeClaimUnavailableResponse>,
      NormalizeWireType<ErrorResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/billing/trial"]["post"],
      TrialOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<TrialResponse>,
      NormalizeWireType<OrganizationBillingResponse>
    >
  >();
});
