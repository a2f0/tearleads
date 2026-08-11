import { test } from "bun:test";
import type { PutPrincipalPolicyRequest } from "../request";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyErrorResponse,
  PrincipalPolicyMutationResponse,
} from "../response";
import type { operations, paths } from "./generatedOpenApi";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
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

type GetPolicyOperation = operations["principals.policy.get"];
type PutPolicyOperation = operations["principals.policy.update"];
type GetPolicyPathParams = GetPolicyOperation["parameters"]["path"];
type GetPolicyResponse =
  GetPolicyOperation["responses"][200]["content"]["application/json"];
type PutPolicyRequest =
  PutPolicyOperation["requestBody"]["content"]["application/json"];
type PutPolicyResponse =
  PutPolicyOperation["responses"][200]["content"]["application/json"];
type PutPolicyConflict =
  PutPolicyOperation["responses"][409]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match principal policy contracts", () => {
  assertType<
    IsEqual<
      paths["/principals/{principalType}/{principalId}/policy"]["get"],
      GetPolicyOperation
    >
  >();
  assertType<
    IsEqual<
      paths["/principals/{principalType}/{principalId}/policy"]["put"],
      PutPolicyOperation
    >
  >();
  assertType<
    IsAssignable<
      GetPolicyPathParams,
      { principalId: string; principalType: "group" | "organization" }
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GetPolicyResponse>,
      NormalizeWireType<PrincipalPolicyBundleResponse>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<PutPolicyRequest>,
      NormalizeWireType<PutPrincipalPolicyRequest>
    >
  >();
  // Nested loose response records intentionally use the same one-way
  // generated-to-runtime contract as the container mutation type test.
  assertType<
    IsAssignable<
      NormalizeWireType<PutPolicyResponse>,
      NormalizeWireType<PrincipalPolicyMutationResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<PutPolicyConflict>,
      NormalizeWireType<PrincipalPolicyErrorResponse>
    >
  >();
});
