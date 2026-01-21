import { DEFAULT_OPENROUTER_MODEL_ID, isRecord } from '@rapid/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { OPENROUTER_API_URL } from './chat.js';

const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
let previousApiKey: string | undefined;

describe('Chat Routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    previousApiKey = process.env['OPENROUTER_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env['OPENROUTER_API_KEY'];
    } else {
      process.env['OPENROUTER_API_KEY'] = previousApiKey;
    }
    vi.unstubAllGlobals();
  });

  describe('POST /v1/chat/completions', () => {
    it('proxies chat completions to OpenRouter', async () => {
      const openRouterResponse = {
        id: 'chatcmpl-1',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello there!'
            }
          }
        ]
      };

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(openRouterResponse), { status: 200 })
      );

      const payload = {
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(openRouterResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const call = fetchMock.mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }

      expect(call[0]).toBe(OPENROUTER_API_URL);

      const requestInit = call[1];
      if (!requestInit || typeof requestInit !== 'object') {
        throw new Error('Expected fetch options to be provided');
      }

      const headers = requestInit.headers;
      if (headers instanceof Headers) {
        expect(headers.get('Authorization')).toBe('Bearer test-key');
        expect(headers.get('Content-Type')).toBe('application/json');
      } else if (isRecord(headers)) {
        expect(headers['Authorization']).toBe('Bearer test-key');
        expect(headers['Content-Type']).toBe('application/json');
      } else {
        throw new Error('Expected headers to be present');
      }

      const body = requestInit.body;
      if (typeof body !== 'string') {
        throw new Error('Expected request body to be a string');
      }

      const parsedBody = JSON.parse(body);
      expect(parsedBody).toEqual({
        model: DEFAULT_OPENROUTER_MODEL_ID,
        messages: payload.messages
      });
    });

    it('accepts multimodal messages with image content', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-vision',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Vision reply'
                }
              }
            ]
          }),
          { status: 200 }
        )
      );

      const payload = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,test' }
              }
            ]
          }
        ]
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .send(payload);

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const call = fetchMock.mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }

      const requestInit = call[1];
      if (!requestInit || typeof requestInit !== 'object') {
        throw new Error('Expected fetch options to be provided');
      }

      const body = requestInit.body;
      if (typeof body !== 'string') {
        throw new Error('Expected request body to be a string');
      }

      const parsedBody = JSON.parse(body);
      expect(parsedBody).toEqual({
        model: DEFAULT_OPENROUTER_MODEL_ID,
        messages: payload.messages
      });
    });

    it('accepts larger image payloads for vision requests', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-vision-large',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Vision reply'
                }
              }
            ]
          }),
          { status: 200 }
        )
      );

      const largeImageData = `data:image/png;base64,${'a'.repeat(200_000)}`;
      const payload = {
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: largeImageData } }]
          }
        ]
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .send(payload);

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('accepts an explicit OpenRouter model ID', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-2',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Model reply'
                }
              }
            ]
          }),
          { status: 200 }
        )
      );

      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: DEFAULT_OPENROUTER_MODEL_ID,
          messages: [{ role: 'user', content: 'Hello' }]
        });

      expect(response.status).toBe(200);

      const call = fetchMock.mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }

      const requestInit = call[1];
      if (!requestInit || typeof requestInit !== 'object') {
        throw new Error('Expected fetch options to be provided');
      }

      const body = requestInit.body;
      if (typeof body !== 'string') {
        throw new Error('Expected request body to be a string');
      }

      const parsedBody = JSON.parse(body);
      expect(parsedBody).toEqual({
        model: DEFAULT_OPENROUTER_MODEL_ID,
        messages: [{ role: 'user', content: 'Hello' }]
      });
    });

    it('returns 400 for invalid payloads', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({ messages: [] });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'messages must be a non-empty array'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 for unsupported OpenRouter models', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: 'unknown/model',
          messages: [{ role: 'user', content: 'Hello' }]
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'model must be a supported OpenRouter chat model'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when messages include invalid entries', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [
            {
              role: 'unknown',
              content: 'Hello'
            }
          ]
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'messages[0].role must be one of: system, user, assistant, tool'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when messages contain non-object items', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: ['not-an-object']
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'messages[0] must be an object'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when messages have empty content', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [
            {
              role: 'user',
              content: '   '
            }
          ]
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'messages[0].content must be a non-empty string'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when messages contain invalid multimodal content', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: '' } }]
            }
          ]
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'messages[0].content[0].image_url.url must be a non-empty string'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a fallback payload when OpenRouter returns non-JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response('service unavailable', { status: 503 })
      );

      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }]
        });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'service unavailable' });
    });

    it('returns an empty payload when OpenRouter returns no content', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 200 }));

      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }]
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });

    it('returns 502 when OpenRouter request fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      fetchMock.mockRejectedValue(new Error('network failed'));

      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }]
        });

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Failed to contact OpenRouter' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'OpenRouter request failed:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('returns 500 when OPENROUTER_API_KEY is missing', async () => {
      process.env['OPENROUTER_API_KEY'] = '';

      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }]
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'OPENROUTER_API_KEY is not configured on the server'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
