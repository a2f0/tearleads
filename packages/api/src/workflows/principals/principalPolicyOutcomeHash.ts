import { createHash } from "node:crypto";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { readKeyingCanonicalJson } from "../../utils/canonicalJson";
import { PrincipalPolicyError } from "./shared";

export function principalPolicyOutcomeHash(value: unknown): string {
  try {
    return createHash("sha256")
      .update(
        serializeKeyingCanonicalJson(
          readKeyingCanonicalJson(
            JSON.parse(JSON.stringify(value)),
            "Principal policy outcome request",
          ),
        ),
      )
      .digest("hex");
  } catch {
    throw new PrincipalPolicyError(
      "Principal policy outcome request is not canonical",
      400,
    );
  }
}
