import {
  MAX_ACCESS_EVENT_NAME_LENGTH,
  MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
} from "@tearleads/validators/util";
import { readString, throwVerification } from "./shared";

/**
 * A name its signer chooses freely, such as the device it signed on: a
 * non-empty string of at most `maxLength` characters, none of them a
 * control character. A signed record is stored as it was signed, and a
 * store refuses a string it cannot hold: Postgres takes no U+0000 in `text`
 * or `jsonb`. So a name that verifies is one every store keeps, and a
 * record that could not be stored is refused for its shape, where it is
 * parsed, and not by the store.
 */
function readSignedName(
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string {
  const name = readString(record, key, label);
  if (name.length > maxLength) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} may be at most ${maxLength} characters`,
    );
  }
  if (/\p{Cc}/u.test(name)) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} may not hold a control character`,
    );
  }
  return name;
}

/**
 * The device a header's writer signed on. Nothing else in a header is a
 * free string its writer chooses, so with the citation bound this bounds
 * every header.
 */
export function readWriterDeviceId(record: Record<string, unknown>): string {
  return readSignedName(
    record,
    "writerDeviceId",
    "write header",
    MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
  );
}

/**
 * An access event's own id or the device its signer signed on: the two
 * strings of an event header that are neither a hash, a timestamp, nor an
 * id the server matches against a row it holds.
 */
export function readAccessEventName(
  record: Record<string, unknown>,
  key: "eventId" | "signerDeviceId",
): string {
  return readSignedName(
    record,
    key,
    "access event",
    MAX_ACCESS_EVENT_NAME_LENGTH,
  );
}
