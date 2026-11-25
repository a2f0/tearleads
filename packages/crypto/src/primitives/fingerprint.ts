export async function toFingerprint(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}
