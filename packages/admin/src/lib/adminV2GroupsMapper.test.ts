import { describe, expect, it } from 'vitest';
import { mapGroupsListResponse } from './adminV2GroupsMapper';

describe('mapGroupsListResponse', () => {
  it('maps v2 payload to GroupsListResponse', () => {
    const mapped = mapGroupsListResponse({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Admin',
          description: 'Operators',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          memberCount: 3
        }
      ]
    });

    expect(mapped).toEqual({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Admin',
          description: 'Operators',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          memberCount: 3
        }
      ]
    });
  });

  it('falls back safely for invalid payload values', () => {
    const mapped = mapGroupsListResponse({
      groups: [
        {
          id: 9,
          organizationId: null,
          name: undefined,
          description: false,
          createdAt: 123,
          updatedAt: null,
          memberCount: 'not-a-number'
        }
      ]
    });

    expect(mapped).toEqual({
      groups: [
        {
          id: '',
          organizationId: '',
          name: '',
          description: null,
          createdAt: '',
          updatedAt: '',
          memberCount: 0
        }
      ]
    });
  });
});
