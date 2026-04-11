import { expect, test } from "bun:test";
import { getDriverLicenseAttachmentBySlotId } from "./driverLicenseDocument";

test("driver's license attachment lookup returns the latest slot binding", () => {
  const attachment = getDriverLicenseAttachmentBySlotId(
    [
      {
        byteLength: 10,
        mimeType: "image/jpeg",
        name: "front-original.jpg",
        slotId: "front",
      },
      {
        byteLength: 20,
        mimeType: "image/jpeg",
        name: "front-updated.jpg",
        slotId: "front",
      },
    ],
    "front",
  );

  expect(attachment).toEqual({
    byteLength: 20,
    mimeType: "image/jpeg",
    name: "front-updated.jpg",
    slotId: "front",
  });
});
