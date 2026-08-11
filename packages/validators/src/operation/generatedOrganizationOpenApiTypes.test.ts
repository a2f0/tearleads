import { test } from "bun:test";
import type {
  CreateOrganizationGroupWithPolicyRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "../request";
import type {
  CreateOrganizationGroupResponse,
  DeleteOrganizationGroupResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupMembersResponse,
  OrganizationProfileResponse,
  OrganizationReadModelResponse,
  PaymentRequiredErrorResponse,
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

type CreateGroupOperation = operations["organizations.groups.create"];
type CreateGroupPathParams = CreateGroupOperation["parameters"]["path"];
type CreateGroupRequest =
  CreateGroupOperation["requestBody"]["content"]["application/json"];
type CreateGroupResponse =
  CreateGroupOperation["responses"][200]["content"]["application/json"];
type PaymentRequiredResponse =
  CreateGroupOperation["responses"][402]["content"]["application/json"];
type DeleteGroupOperation = operations["organizations.groups.delete"];
type DeleteGroupResponse =
  DeleteGroupOperation["responses"][200]["content"]["application/json"];
type GroupMembersOperation = operations["organizations.groups.members.list"];
type GroupMembersResponse =
  GroupMembersOperation["responses"][200]["content"]["application/json"];
type ReadModelOperation = operations["organizations.readModel.get"];
type ReadModelQuery = NonNullable<ReadModelOperation["parameters"]["query"]>;
type ReadModelResponse =
  ReadModelOperation["responses"][200]["content"]["application/json"];
type UpdateProfileOperation = operations["organizations.profile.update"];
type UpdateProfileRequest =
  UpdateProfileOperation["requestBody"]["content"]["application/json"];
type UpdateProfileResponse =
  UpdateProfileOperation["responses"][200]["content"]["application/json"];
type UpdateRosterOperation = operations["organizations.roster.update"];
type UpdateRosterRequest =
  UpdateRosterOperation["requestBody"]["content"]["application/json"];
type UpdateRosterResponse =
  UpdateRosterOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match organization management contracts", () => {
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/groups"]["post"],
      CreateGroupOperation
    >
  >();
  assertType<IsAssignable<CreateGroupPathParams, { organizationId: string }>>();
  assertType<
    IsAssignable<CreateGroupRequest, CreateOrganizationGroupWithPolicyRequest>
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<CreateGroupResponse>,
      NormalizeWireType<CreateOrganizationGroupResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<PaymentRequiredResponse>,
      NormalizeWireType<PaymentRequiredErrorResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/groups/{groupId}"]["delete"],
      DeleteGroupOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<DeleteGroupResponse>,
      NormalizeWireType<DeleteOrganizationGroupResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/groups/{groupId}/members"]["get"],
      GroupMembersOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GroupMembersResponse>,
      NormalizeWireType<OrganizationGroupMembersResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/read-model"]["get"],
      ReadModelOperation
    >
  >();
  assertType<IsAssignable<ReadModelQuery, { cursor?: string }>>();
  assertType<
    IsEqual<
      NormalizeWireType<ReadModelResponse>,
      NormalizeWireType<OrganizationReadModelResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/profile"]["put"],
      UpdateProfileOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<UpdateProfileRequest>,
      NormalizeWireType<UpdateOrganizationProfileRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<UpdateProfileResponse>,
      NormalizeWireType<OrganizationProfileResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/organizations/{organizationId}/roster/{userId}"]["put"],
      UpdateRosterOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<UpdateRosterRequest>,
      NormalizeWireType<UpdateOrganizationRosterEntryRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<UpdateRosterResponse>,
      NormalizeWireType<OrganizationDirectoryUserResponse>
    >
  >();
});
