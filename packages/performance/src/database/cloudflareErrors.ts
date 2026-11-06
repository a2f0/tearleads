import { jsonRecord } from "../jsonRecord";

/** The `secret_text` binding values a Worker upload form carries. */
function uploadSecretTexts(body: unknown): string[] {
  if (!(body instanceof FormData)) return [];
  const metadata = body.get("metadata");
  if (typeof metadata !== "string") return [];
  const bindings: unknown = Reflect.get(
    jsonRecord(JSON.parse(metadata)),
    "bindings",
  );
  if (!Array.isArray(bindings)) return [];
  const secrets: string[] = [];
  for (const binding of bindings) {
    const record = jsonRecord(binding);
    const text: unknown = Reflect.get(record, "text");
    if (
      Reflect.get(record, "type") === "secret_text" &&
      typeof text === "string"
    )
      secrets.push(text);
  }
  return secrets;
}

/** Provider validation errors help diagnose bundles; redact upload secrets first. */
export async function cloudflareFailure(
  response: Response,
  token: string,
  body: unknown,
) {
  const secrets = [token, ...uploadSecretTexts(body)];
  const envelope = jsonRecord(await response.json().catch(() => null));
  const errors: unknown = Reflect.get(envelope, "errors");
  if (!Array.isArray(errors)) return "";
  return errors
    .slice(0, 2)
    .map((error) => {
      const record = jsonRecord(error);
      const code: unknown = Reflect.get(record, "code");
      const message: unknown = Reflect.get(record, "message");
      let safe = typeof message === "string" ? message : "";
      for (const secret of secrets)
        if (secret) safe = safe.replaceAll(secret, "[redacted]");
      return `${typeof code === "number" ? code : "unknown"}: ${safe.slice(0, 800)}`;
    })
    .join("; ");
}
