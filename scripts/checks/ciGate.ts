import { assertCiSuccess } from "./ciPolicy";

const { CI_NEEDS: needs } = process.env;
if (!needs) throw new Error("CI_NEEDS is required.");
assertCiSuccess(JSON.parse(needs));
console.log("All applicable CI checks passed.");
