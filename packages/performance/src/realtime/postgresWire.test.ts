import { expect, test } from "bun:test";
import {
  countConnection,
  emptyTraffic,
  PostgresMessageStream,
  trafficSince,
} from "./postgresWire";

function message(type: string, body: Uint8Array = new Uint8Array()) {
  const bytes = new Uint8Array(5 + body.length);
  bytes[0] = type.charCodeAt(0);
  new DataView(bytes.buffer).setInt32(1, 4 + body.length);
  bytes.set(body, 5);
  return bytes;
}

function startup(code: number, extra = 0) {
  const bytes = new Uint8Array(8 + extra);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 8 + extra);
  view.setInt32(4, code);
  return bytes;
}

function concat(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

test("counts messages however the stream is split", () => {
  const stream = concat(
    startup(196608, 12),
    message("P", new Uint8Array(30)),
    message("B", new Uint8Array(9)),
    message("E", new Uint8Array(5)),
    message("S"),
    message("Q", new Uint8Array(17)),
  );
  for (const size of [1, 2, 3, 7, stream.length]) {
    const types: string[] = [];
    const parser = new PostgresMessageStream((type) => types.push(type), {
      startup: true,
    });
    for (let offset = 0; offset < stream.length; offset += size)
      parser.push(stream.subarray(offset, offset + size));
    expect(types).toEqual(["startup", "P", "B", "E", "S", "Q"]);
  }
});

test("refuses encrypted connections and malformed lengths", () => {
  const encrypted = new PostgresMessageStream(() => undefined, {
    startup: true,
  });
  expect(() => encrypted.push(startup(80877103))).toThrow(/Encrypted/);
  const malformed = new PostgresMessageStream(() => undefined, {
    startup: false,
  });
  const bad = message("D");
  new DataView(bad.buffer).setInt32(1, 3);
  expect(() => malformed.push(bad)).toThrow(/Malformed/);
});

test("tallies statements, exchanges, rows, and bytes per direction", () => {
  const traffic = emptyTraffic();
  const before = { ...traffic };
  const connection = countConnection(traffic);
  const sent = concat(
    startup(196608, 4),
    message("Q", new Uint8Array(6)),
    message("P", new Uint8Array(3)),
    message("E", new Uint8Array(5)),
    message("S"),
  );
  const returned = concat(
    message("Z", new Uint8Array(1)),
    message("T", new Uint8Array(20)),
    message("D", new Uint8Array(40)),
    message("D", new Uint8Array(40)),
    message("C", new Uint8Array(9)),
    message("Z", new Uint8Array(1)),
    message("Z", new Uint8Array(1)),
  );
  connection.sent(sent);
  connection.returned(returned);
  expect(trafficSince(traffic, before)).toEqual({
    connections: 1,
    statements: 2,
    roundTrips: 3,
    rows: 2,
    bytesSent: sent.length,
    bytesReturned: returned.length,
  });
});
