// Import integration setup FIRST - wires real db-test-utils adapter/key manager
import '../test/setup-integration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabaseAdapter, resetDatabase, setupDatabase } from './index';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle
} from './vehicles';

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('vehicles integration', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
  });

  it('creates vehicles table through migrations', async () => {
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
    const adapter = getDatabaseAdapter();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vehicles'",
      []
    );

    expect(result.rows).toHaveLength(1);
  });

  it('creates, updates, and soft deletes vehicle rows', async () => {
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

    const created = await createVehicle({
      make: 'Tesla',
      model: 'Model 3',
      year: 2023,
      color: 'Red'
    });

    expect(created).not.toBeNull();
    const createdId = created?.id;
    expect(typeof createdId).toBe('string');

    const listedAfterCreate = await listVehicles();
    expect(listedAfterCreate).toHaveLength(1);
    expect(listedAfterCreate[0]?.make).toBe('Tesla');
    expect(listedAfterCreate[0]?.model).toBe('Model 3');

    if (!createdId) {
      throw new Error('Expected created vehicle id');
    }

    const updated = await updateVehicle(createdId, {
      make: 'Tesla',
      model: 'Model 3 Performance',
      year: 2024,
      color: 'Midnight Silver'
    });

    expect(updated?.model).toBe('Model 3 Performance');
    expect(updated?.year).toBe(2024);

    const deleted = await deleteVehicle(createdId);
    expect(deleted).toBe(true);

    const listedAfterDelete = await listVehicles();
    expect(listedAfterDelete).toEqual([]);
  });
});
