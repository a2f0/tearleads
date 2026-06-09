import conventionalConfig from "@commitlint/config-conventional";

const conventionalTypeEnum = conventionalConfig.rules["type-enum"];
const conventionalTypes = conventionalTypeEnum[2];
export const commitHeaderMaxLength = 50;

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      Array.from(new Set([...conventionalTypes, "cleanup"])),
    ],
    "header-max-length": [2, "always", commitHeaderMaxLength],
  },
};
