import { describe, expect, it } from 'vitest';
import {
  healthExercises as postgresHealthExercises,
  healthHeightReadings as postgresHealthHeightReadings
} from './postgresql/schema.js';
import {
  healthExercises as postgresHealthExercisesFromFoundation,
  healthHeightReadings as postgresHealthHeightReadingsFromFoundation
} from './postgresql/schema-foundation.js';
import {
  healthExercises as postgresHealthExercisesFromHealth,
  healthHeightReadings as postgresHealthHeightReadingsFromHealth
} from './postgresql/schemaHealth.js';
import {
  healthExercises as sqliteHealthExercises,
  healthHeightReadings as sqliteHealthHeightReadings,
  schema as sqliteSchema
} from './sqlite/schema.js';
import {
  healthExercises as sqliteHealthExercisesFromFoundation,
  healthHeightReadings as sqliteHealthHeightReadingsFromFoundation
} from './sqlite/schema-foundation.js';
import {
  healthExercises as sqliteHealthExercisesFromHealth,
  healthHeightReadings as sqliteHealthHeightReadingsFromHealth
} from './sqlite/schemaHealth.js';

describe('generated schema health exports', () => {
  it('keeps sqlite schema health tables in the root schema object', () => {
    expect(sqliteSchema.healthExercises).toBe(sqliteHealthExercises);
    expect(sqliteSchema.healthHeightReadings).toBe(sqliteHealthHeightReadings);
  });

  it('re-exports sqlite health tables through schema-foundation', () => {
    expect(sqliteHealthExercisesFromFoundation).toBe(
      sqliteHealthExercisesFromHealth
    );
    expect(sqliteHealthHeightReadingsFromFoundation).toBe(
      sqliteHealthHeightReadingsFromHealth
    );
  });

  it('keeps non-health sqlite tables out of schemaHealth', async () => {
    const sqliteHealthModule = await import('./sqlite/schemaHealth.js');

    expect('groups' in sqliteHealthModule).toBe(false);
    expect('userGroups' in sqliteHealthModule).toBe(false);
  });

  it('re-exports postgres health tables through schema-foundation', () => {
    expect(postgresHealthExercises).toBe(postgresHealthExercisesFromHealth);
    expect(postgresHealthHeightReadings).toBe(
      postgresHealthHeightReadingsFromHealth
    );
    expect(postgresHealthExercisesFromFoundation).toBe(
      postgresHealthExercisesFromHealth
    );
    expect(postgresHealthHeightReadingsFromFoundation).toBe(
      postgresHealthHeightReadingsFromHealth
    );
  });

  it('keeps non-health postgres tables out of schemaHealth', async () => {
    const postgresHealthModule = await import('./postgresql/schemaHealth.js');

    expect('groups' in postgresHealthModule).toBe(false);
    expect('userGroups' in postgresHealthModule).toBe(false);
  });
});
