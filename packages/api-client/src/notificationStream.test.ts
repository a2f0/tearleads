import {
  SubscribeRequest,
  SubscribeResponse
} from '@tearleads/shared/gen/tearleads/v1/notifications_pb';
import { describe, expect, it, vi } from 'vitest';
import { openNotificationEventStream } from './notificationStream';

interface MockStreamClientCallOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

interface MockStreamClient {
  subscribe: (
    request: SubscribeRequest,
    options?: MockStreamClientCallOptions
  ) => AsyncIterable<SubscribeResponse>;
}

function createAsyncResponseStream(
  payloads: readonly string[]
): AsyncGenerator<SubscribeResponse> {
  return (async function* () {
    for (const payload of payloads) {
      yield new SubscribeResponse({ json: payload });
    }
  })();
}

describe('openNotificationEventStream', () => {
  it('appends /connect to the base URL and passes auth headers', async () => {
    const subscribe = vi.fn(() =>
      createAsyncResponseStream(['{"event":"connected"}'])
    );
    const createClient = vi.fn<MockStreamClient>((_connectBaseUrl) => ({
      subscribe
    }));
    const abortController = new AbortController();
    const events: string[] = [];

    for await (const payload of openNotificationEventStream({
      apiBaseUrl: 'http://localhost:5001/v1/',
      channels: ['broadcast'],
      token: 'Bearer test-token',
      signal: abortController.signal,
      createClient
    })) {
      events.push(payload);
    }

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      'http://localhost:5001/v1/connect'
    );
    expect(subscribe).toHaveBeenCalledTimes(1);

    const firstCall = subscribe.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      return;
    }

    const request = firstCall[0];
    const options = firstCall[1];
    expect(request).toBeInstanceOf(SubscribeRequest);
    expect(request.channels).toEqual(['broadcast']);
    expect(options).toEqual({
      headers: { Authorization: 'Bearer test-token' },
      signal: abortController.signal
    });
    expect(events).toEqual(['{"event":"connected"}']);
  });

  it('preserves already-connected base URLs', async () => {
    const subscribe = vi.fn(() => createAsyncResponseStream([]));
    const createClient = vi.fn<MockStreamClient>(() => ({ subscribe }));

    for await (const _payload of openNotificationEventStream({
      apiBaseUrl: 'http://localhost:5001/v1/connect',
      channels: ['broadcast'],
      createClient
    })) {
      // no-op
    }

    expect(createClient).toHaveBeenCalledWith(
      'http://localhost:5001/v1/connect'
    );
  });

  it('skips empty payloads from the stream', async () => {
    const subscribe = vi.fn(() =>
      createAsyncResponseStream([
        '   ',
        '',
        '{"event":"keepalive"}',
        '{"event":"message","channel":"broadcast"}'
      ])
    );
    const createClient = vi.fn<MockStreamClient>(() => ({ subscribe }));
    const events: string[] = [];

    for await (const payload of openNotificationEventStream({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      createClient
    })) {
      events.push(payload);
    }

    expect(events).toEqual([
      '{"event":"keepalive"}',
      '{"event":"message","channel":"broadcast"}'
    ]);
  });
});
