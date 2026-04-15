import { routeApp } from "../../../../src/routeApp";

export async function stageBlob(
  input: {
    encryptedBytes: string;
    byteLength: number;
    sha256: string;
  },
  token: string,
): Promise<Response> {
  return routeApp.request("/blobs/stage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}
