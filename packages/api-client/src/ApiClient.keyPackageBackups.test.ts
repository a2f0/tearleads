import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createKeyPackageBackupResponse,
  createPutKeyPackageBackupRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient("uses key package backup routes", async () => {
  const calls: CapturedHttpCall[] = [];
  const putRequest = createPutKeyPackageBackupRequest();
  const response = createKeyPackageBackupResponse(putRequest);
  server.use(
    http.all(`${apiBaseUrl}/auth/key-package-backups*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));

      if (
        request.method === "GET" &&
        request.url.endsWith("/key-package-backups")
      ) {
        return HttpResponse.json({ backups: [response] });
      }
      if (request.method === "DELETE") {
        return HttpResponse.json({ message: "ok" });
      }

      return HttpResponse.json(response);
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  client.setAuthToken("abc");

  expect(await client.putKeyPackageBackup(putRequest)).toEqual(response);
  expect(await client.listKeyPackageBackups()).toEqual({ backups: [response] });
  expect(
    await client.getKeyPackageBackupByCredentialId("credential/id with space"),
  ).toEqual(response);
  expect(await client.deleteKeyPackageBackup(putRequest.backupId)).toEqual({
    message: "ok",
  });

  expect(
    calls.map((call) => ({
      authorization: call.authorization,
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      authorization: "Bearer abc",
      body: JSON.stringify(putRequest),
      input: `${apiBaseUrl}/auth/key-package-backups/${putRequest.backupId}`,
      method: "PUT",
    },
    {
      authorization: "Bearer abc",
      body: null,
      input: `${apiBaseUrl}/auth/key-package-backups`,
      method: "GET",
    },
    {
      authorization: "Bearer abc",
      body: null,
      input: `${apiBaseUrl}/auth/key-package-backups/by-credential?credentialId=credential%2Fid%20with%20space`,
      method: "GET",
    },
    {
      authorization: "Bearer abc",
      body: "",
      input: `${apiBaseUrl}/auth/key-package-backups/${putRequest.backupId}`,
      method: "DELETE",
    },
  ]);
});
