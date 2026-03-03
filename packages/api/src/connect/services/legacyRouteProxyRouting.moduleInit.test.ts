import { describe, expect, it, vi } from 'vitest';

function createMixedRouter() {
  const handler = vi.fn();
  const rootHandler = vi.fn();

  return {
    stack: [
      'not-record',
      { route: null },
      {
        route: {
          path: 123,
          methods: { get: true },
          stack: [{ handle: handler }]
        }
      },
      {
        route: {
          path: '/disabled',
          methods: { get: false },
          stack: [{ handle: handler }]
        }
      },
      {
        route: {
          path: '/unknown-method',
          methods: { trace: true },
          stack: [{ handle: handler }]
        }
      },
      {
        route: {
          path: '/no-handler',
          methods: { get: true },
          stack: [{ handle: 'not-a-function' }]
        }
      },
      {
        route: {
          path: '/bad//segment',
          methods: { get: true },
          stack: [{ handle: handler }]
        }
      },
      {
        route: {
          path: '/bad-param/:',
          methods: { get: true },
          stack: [{ handle: handler }]
        }
      },
      {
        route: {
          path: '/:id',
          methods: { get: true },
          stack: [{ handle: handler }]
        }
      },
      {
        route: {
          path: 'relative',
          methods: { get: true, post: true },
          stack: [{ handle: 'bad' }, { handle: handler }]
        }
      },
      {
        route: {
          path: '/',
          methods: { get: true },
          stack: [{ handle: rootHandler }]
        }
      }
    ]
  };
}

describe('legacyRouteProxyRouting module initialization', () => {
  it('handles non-router and malformed stack inputs', async () => {
    vi.resetModules();

    vi.doMock('../../routes/vfs/router.js', () => ({
      vfsRouter: null
    }));

    const routingWithNullRouter = await import('./legacyRouteProxyRouting.js');
    expect(routingWithNullRouter.findRoute('GET', '/vfs/keys/me')).toBeNull();

    vi.resetModules();
    vi.doMock('../../routes/vfs/router.js', () => ({
      vfsRouter: { stack: 'not-an-array' }
    }));

    const routingWithMalformedStack = await import(
      './legacyRouteProxyRouting.js'
    );
    expect(routingWithMalformedStack.findRoute('GET', '/vfs/keys/me')).toBeNull();
  });

  it('handles mixed router stacks and unsupported route metadata', async () => {
    vi.resetModules();

    const mixedRouter = createMixedRouter();
    vi.doMock('../../routes/vfs/router.js', () => ({
      vfsRouter: mixedRouter
    }));

    const routing = await import('./legacyRouteProxyRouting.js');

    expect(routing.findRoute('GET', '/vfs/relative')).not.toBeNull();
    expect(routing.findRoute('POST', '/vfs/relative')).not.toBeNull();
    expect(routing.findRoute('GET', '/vfs')).not.toBeNull();

    const decoded = routing.findRoute('GET', '/vfs/a%2Fb');
    expect(decoded).not.toBeNull();
    if (!decoded) {
      throw new Error('Expected dynamic route match');
    }
    expect(decoded.params).toEqual({ id: 'a/b' });

    expect(routing.findRoute('GET', '/vfs/%E0%A4%A')).toBeNull();
    expect(routing.findRoute('GET', '/')).toBeNull();
    expect(routing.findRoute('GET', '/vfs/bad//segment')).toBeNull();
    expect(routing.findRoute('GET', '/vfs/bad-param/value')).toBeNull();
  });
});
