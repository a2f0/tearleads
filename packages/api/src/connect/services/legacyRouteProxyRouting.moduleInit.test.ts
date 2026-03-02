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
  it('handles mixed router stacks and unsupported route metadata', async () => {
    vi.resetModules();

    vi.doMock('../../routes/admin/context.js', () => ({
      adminContextRouter: null
    }));
    vi.doMock('../../routes/admin/groups.js', () => ({
      groupsRouter: { stack: 'not-an-array' }
    }));

    const mixedRouter = createMixedRouter();
    vi.doMock('../../routes/admin/organizations.js', () => ({
      organizationsRouter: mixedRouter
    }));

    const emptyRouter = { stack: [] };
    vi.doMock('../../routes/admin/postgres.js', () => ({
      postgresRouter: emptyRouter
    }));
    vi.doMock('../../routes/admin/redis.js', () => ({
      redisRouter: emptyRouter
    }));
    vi.doMock('../../routes/admin/users.js', () => ({
      usersRouter: emptyRouter
    }));
    vi.doMock('../../routes/mls/router.js', () => ({
      mlsRouter: emptyRouter
    }));
    vi.doMock('../../routes/vfs/router.js', () => ({
      vfsRouter: emptyRouter
    }));

    const routing = await import('./legacyRouteProxyRouting.js');

    expect(
      routing.findRoute('GET', '/admin/organizations/relative')
    ).not.toBeNull();
    expect(
      routing.findRoute('POST', '/admin/organizations/relative')
    ).not.toBeNull();
    expect(routing.findRoute('GET', '/admin/organizations')).not.toBeNull();

    const decoded = routing.findRoute('GET', '/admin/organizations/a%2Fb');
    expect(decoded).not.toBeNull();
    if (!decoded) {
      throw new Error('Expected dynamic route match');
    }
    expect(decoded.params).toEqual({ id: 'a/b' });

    expect(
      routing.findRoute('GET', '/admin/organizations/%E0%A4%A')
    ).toBeNull();
    expect(
      routing.findRoute('GET', '/admin/organizations/bad-param/value')
    ).toBeNull();
  });
});
