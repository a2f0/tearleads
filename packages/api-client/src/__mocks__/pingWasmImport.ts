export function importPingWasmModule(): Promise<unknown> {
  return Promise.resolve({
    v2_ping_path: () => '/v2/ping',
    parse_v2_ping_value: (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid v2 ping response payload');
      }
      return payload;
    }
  });
}
