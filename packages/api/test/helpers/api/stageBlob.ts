import { app } from "../../../src/index";

export async function stageBlob(
  input: {
    encryptedBytes: string;
    byteLength: number;
    sha256: string;
  },
  token: string,
): Promise<Response> {
  return app.request("/blobs/stage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}
