import { test } from "bun:test";
import type { HealthResponse } from "../response";
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
type NormalizeWireType<Value> = Value extends object
  ? {
      [Key in keyof WithoutIndexSignatures<Value>]: NormalizeWireType<
        Exclude<WithoutIndexSignatures<Value>[Key], undefined>
      >;
    }
  : Value;

type HealthOperation = operations["health.get"];
type HealthOperationResponse =
  HealthOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match the health contract", () => {
  assertType<IsEqual<paths["/"]["get"], HealthOperation>>();
  assertType<
    IsEqual<
      NormalizeWireType<HealthOperationResponse>,
      NormalizeWireType<HealthResponse>
    >
  >();
});
