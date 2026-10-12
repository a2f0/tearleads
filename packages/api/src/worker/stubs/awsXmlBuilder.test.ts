import { expect, test } from "bun:test";
import { parseXML } from "./awsXmlBuilder";

test("the Worker's XML parser decodes an S3 multipart response without a DOM", () => {
  expect(
    parseXML(
      `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>tearleads-staging</Bucket>
  <Key>blobs/stage-1</Key>
  <UploadId>upload-1</UploadId>
</InitiateMultipartUploadResult>`,
    ),
  ).toEqual({
    InitiateMultipartUploadResult: {
      Bucket: "tearleads-staging",
      Key: "blobs/stage-1",
      UploadId: "upload-1",
      xmlns: "http://s3.amazonaws.com/doc/2006-03-01/",
    },
  });
});
