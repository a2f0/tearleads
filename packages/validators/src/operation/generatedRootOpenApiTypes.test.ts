import { test } from "bun:test";
import type {
  RootIdentitiesResponse,
  RootIdentityDetailResponse,
  RootIdentityOrganizationsResponse,
} from "../response";
import type { operations, paths } from "./generatedOpenApi";

type IsAssignable<Left, Right> = [Left] extends [Right] ? true : false;
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

type ListIdentitiesOperation = operations["root.identities.list"];
type ListIdentitiesQuery = NonNullable<
  ListIdentitiesOperation["parameters"]["query"]
>;
type ListIdentitiesResponse =
  ListIdentitiesOperation["responses"][200]["content"]["application/json"];
type GetIdentityOperation = operations["root.identities.get"];
type GetIdentityPathParams = GetIdentityOperation["parameters"]["path"];
type GetIdentityResponse =
  GetIdentityOperation["responses"][200]["content"]["application/json"];
type ListIdentityOrganizationsOperation =
  operations["root.identities.organizations.list"];
type ListIdentityOrganizationsResponse =
  ListIdentityOrganizationsOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match the root administration contracts", () => {
  assertType<
    IsEqual<paths["/root/identities"]["get"], ListIdentitiesOperation>
  >();
  assertType<
    IsAssignable<
      { cursor: string; fingerprint: string; limit: number },
      ListIdentitiesQuery
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<ListIdentitiesResponse>,
      NormalizeWireType<RootIdentitiesResponse>
    >
  >();

  assertType<
    IsEqual<paths["/root/identities/{userId}"]["get"], GetIdentityOperation>
  >();
  assertType<IsAssignable<GetIdentityPathParams, { userId: string }>>();
  assertType<
    IsAssignable<
      NormalizeWireType<GetIdentityResponse>,
      NormalizeWireType<RootIdentityDetailResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/root/identities/{userId}/organizations"]["get"],
      ListIdentityOrganizationsOperation
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<ListIdentityOrganizationsResponse>,
      NormalizeWireType<RootIdentityOrganizationsResponse>
    >
  >();
});
