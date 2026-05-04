import type { IConfiguration, ICruiseOptions } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";

import dependencyCruiserConfig from "../dependency-cruiser.config";

const architectureEntryPoints = ["packages/api/src", "packages/app/src"];

function configToCruiseOptions(config: IConfiguration): ICruiseOptions {
  const { options = {}, ...ruleSet } = config;

  return {
    ...options,
    outputType: "err",
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  };
}

const result = await cruise(
  architectureEntryPoints,
  configToCruiseOptions(dependencyCruiserConfig),
);

if (typeof result.output === "string" && result.output.trim().length > 0) {
  const write = result.exitCode === 0 ? console.log : console.error;
  write(result.output.trim());
}

process.exit(result.exitCode);
