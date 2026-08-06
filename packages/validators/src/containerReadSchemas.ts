import { z } from "zod";
import { registerJsonSchemaFragment } from "./jsonSchema";

export const ContainerParentLaneIdSchema = registerJsonSchemaFragment(
  z.custom<string>(
    (value) =>
      typeof value === "string" && value.length > 0 && value.length <= 64,
  ),
  { maxLength: 64, minLength: 1, type: "string" },
);
