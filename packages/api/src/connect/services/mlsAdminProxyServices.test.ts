import { describe, it } from 'vitest';
import { adminConnectService } from './adminService.js';
import { mlsConnectService } from './mlsService.js';
import {
  createTestContext,
  useProxyFetchMock
} from './proxyServiceTestHelpers.js';

describe('mls and admin proxy services', () => {
  const { mockJsonResponse, expectLastFetch } = useProxyFetchMock();

  it('routes mls service methods', async () => {
    const context = createTestContext();

    const cases = [
      {
        call: () =>
          mlsConnectService.uploadKeyPackages(
            { json: '{"keyPackages":[]}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/key-packages',
        method: 'POST',
        body: '{"keyPackages":[]}'
      },
      {
        call: () => mlsConnectService.getMyKeyPackages({}, context),
        url: 'http://127.0.0.1:55661/v1/mls/key-packages/me',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.getUserKeyPackages({ userId: 'user-1' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/key-packages/user-1',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.deleteKeyPackage({ id: 'pkg-1' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/key-packages/pkg-1',
        method: 'DELETE'
      },
      {
        call: () =>
          mlsConnectService.createGroup({ json: '{"name":"g"}' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/groups',
        method: 'POST',
        body: '{"name":"g"}'
      },
      {
        call: () => mlsConnectService.listGroups({}, context),
        url: 'http://127.0.0.1:55661/v1/mls/groups',
        method: 'GET'
      },
      {
        call: () => mlsConnectService.getGroup({ groupId: 'group-1' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-1',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.updateGroup(
            { groupId: 'group-2', json: '{"name":"next"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-2',
        method: 'PATCH',
        body: '{"name":"next"}'
      },
      {
        call: () =>
          mlsConnectService.deleteGroup({ groupId: 'group-3' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-3',
        method: 'DELETE'
      },
      {
        call: () =>
          mlsConnectService.addGroupMember(
            { groupId: 'group-4', json: '{"userId":"u1"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-4/members',
        method: 'POST',
        body: '{"userId":"u1"}'
      },
      {
        call: () =>
          mlsConnectService.getGroupMembers({ groupId: 'group-5' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-5/members',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.removeGroupMember(
            { groupId: 'group-6', userId: 'u2', json: '{"newEpoch":2}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-6/members/u2',
        method: 'DELETE',
        body: '{"newEpoch":2}'
      },
      {
        call: () =>
          mlsConnectService.sendGroupMessage(
            { groupId: 'group-7', json: '{"ciphertext":"x"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-7/messages',
        method: 'POST',
        body: '{"ciphertext":"x"}'
      },
      {
        call: () =>
          mlsConnectService.getGroupMessages(
            { groupId: 'group-8', cursor: 'c-1', limit: 20 },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-8/messages?cursor=c-1&limit=20',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.getGroupState({ groupId: 'group-9' }, context),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-9/state',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.uploadGroupState(
            { groupId: 'group-10', json: '{"epoch":3}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/groups/group-10/state',
        method: 'POST',
        body: '{"epoch":3}'
      },
      {
        call: () => mlsConnectService.getWelcomeMessages({}, context),
        url: 'http://127.0.0.1:55661/v1/mls/welcome-messages',
        method: 'GET'
      },
      {
        call: () =>
          mlsConnectService.acknowledgeWelcome(
            { id: 'welcome-1', json: '{"groupId":"g"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/mls/welcome-messages/welcome-1/ack',
        method: 'POST',
        body: '{"groupId":"g"}'
      }
    ];

    for (const testCase of cases) {
      mockJsonResponse();
      await testCase.call();
      expectLastFetch(testCase.url, testCase.method, testCase.body);
    }
  });

  it('routes admin service methods', async () => {
    const context = createTestContext();

    const cases = [
      {
        call: () => adminConnectService.getContext({}, context),
        url: 'http://127.0.0.1:55661/v1/admin/context',
        method: 'GET'
      },
      {
        call: () => adminConnectService.getPostgresInfo({}, context),
        url: 'http://127.0.0.1:55661/v1/admin/postgres/info',
        method: 'GET'
      },
      {
        call: () => adminConnectService.getTables({}, context),
        url: 'http://127.0.0.1:55661/v1/admin/postgres/tables',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.getColumns(
            { schema: 'public', table: 'users' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/postgres/tables/public/users/columns',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.getRows(
            {
              schema: 'public',
              table: 'users',
              limit: 10,
              offset: 5,
              sortColumn: 'email',
              sortDirection: 'asc'
            },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/postgres/tables/public/users/rows?limit=10&offset=5&sortColumn=email&sortDirection=asc',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.getRedisKeys(
            { cursor: 'c-1', limit: 25 },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/redis/keys?cursor=c-1&limit=25',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.getRedisValue({ key: 'session:1' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/redis/keys/session%3A1',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.deleteRedisKey({ key: 'session:2' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/redis/keys/session%3A2',
        method: 'DELETE'
      },
      {
        call: () => adminConnectService.getRedisDbSize({}, context),
        url: 'http://127.0.0.1:55661/v1/admin/redis/dbsize',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.listGroups({ organizationId: 'org-1' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/groups?organizationId=org-1',
        method: 'GET'
      },
      {
        call: () => adminConnectService.getGroup({ id: 'group-1' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/groups/group-1',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.createGroup({ json: '{"name":"x"}' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/groups',
        method: 'POST',
        body: '{"name":"x"}'
      },
      {
        call: () =>
          adminConnectService.updateGroup(
            { id: 'group-2', json: '{"name":"y"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/groups/group-2',
        method: 'PUT',
        body: '{"name":"y"}'
      },
      {
        call: () => adminConnectService.deleteGroup({ id: 'group-3' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/groups/group-3',
        method: 'DELETE'
      },
      {
        call: () =>
          adminConnectService.getGroupMembers({ id: 'group-4' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/groups/group-4/members',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.addGroupMember(
            { id: 'group-5', json: '{"userId":"u1"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/groups/group-5/members',
        method: 'POST',
        body: '{"userId":"u1"}'
      },
      {
        call: () =>
          adminConnectService.removeGroupMember(
            { groupId: 'group-6', userId: 'u2' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/groups/group-6/members/u2',
        method: 'DELETE'
      },
      {
        call: () =>
          adminConnectService.listOrganizations(
            { organizationId: 'org-2' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/organizations?organizationId=org-2',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.getOrganization({ id: 'org-3' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/organizations/org-3',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.createOrganization(
            { json: '{"name":"Org"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/organizations',
        method: 'POST',
        body: '{"name":"Org"}'
      },
      {
        call: () =>
          adminConnectService.updateOrganization(
            { id: 'org-4', json: '{"name":"Org 4"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/organizations/org-4',
        method: 'PUT',
        body: '{"name":"Org 4"}'
      },
      {
        call: () =>
          adminConnectService.deleteOrganization({ id: 'org-5' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/organizations/org-5',
        method: 'DELETE'
      },
      {
        call: () => adminConnectService.getOrgUsers({ id: 'org-6' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/organizations/org-6/users',
        method: 'GET'
      },
      {
        call: () => adminConnectService.getOrgGroups({ id: 'org-7' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/organizations/org-7/groups',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.listUsers({ organizationId: 'org-8' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/users?organizationId=org-8',
        method: 'GET'
      },
      {
        call: () => adminConnectService.getUser({ id: 'user-9' }, context),
        url: 'http://127.0.0.1:55661/v1/admin/users/user-9',
        method: 'GET'
      },
      {
        call: () =>
          adminConnectService.updateUser(
            { id: 'user-10', json: '{"disabled":true}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/admin/users/user-10',
        method: 'PATCH',
        body: '{"disabled":true}'
      }
    ];

    for (const testCase of cases) {
      mockJsonResponse();
      await testCase.call();
      expectLastFetch(testCase.url, testCase.method, testCase.body);
    }
  });

  it('omits optional admin query params when values are empty', async () => {
    const context = createTestContext();

    mockJsonResponse();
    await adminConnectService.getRows(
      {
        schema: 'public',
        table: 'users',
        limit: 0,
        offset: -1,
        sortColumn: '',
        sortDirection: ' '
      },
      context
    );
    expectLastFetch(
      'http://127.0.0.1:55661/v1/admin/postgres/tables/public/users/rows',
      'GET'
    );

    mockJsonResponse();
    await adminConnectService.getRows(
      {
        schema: 'public',
        table: 'users',
        limit: 0,
        offset: 0,
        sortColumn: '',
        sortDirection: ''
      },
      context
    );
    expectLastFetch(
      'http://127.0.0.1:55661/v1/admin/postgres/tables/public/users/rows?offset=0',
      'GET'
    );

    mockJsonResponse();
    await adminConnectService.getRedisKeys({ cursor: '', limit: 0 }, context);
    expectLastFetch('http://127.0.0.1:55661/v1/admin/redis/keys', 'GET');

    mockJsonResponse();
    await adminConnectService.listGroups({ organizationId: '' }, context);
    expectLastFetch('http://127.0.0.1:55661/v1/admin/groups', 'GET');
  });
});
