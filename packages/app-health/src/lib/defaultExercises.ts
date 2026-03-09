/**
 * Default exercise IDs (UUIDs) that are pre-seeded and have i18n support.
 * These IDs are stable and used as translation keys.
 *
 * Format: ex_<uuid> for clarity and to distinguish from user-created exercises.
 */
export const DEFAULT_EXERCISE_IDS = {
  BACK_SQUAT: 'ex_a1b2c3d4-1001-4000-8000-000000000001',
  BENCH_PRESS: 'ex_a1b2c3d4-1002-4000-8000-000000000002',
  DEADLIFT: 'ex_a1b2c3d4-1003-4000-8000-000000000003',
  OVERHEAD_PRESS: 'ex_a1b2c3d4-1004-4000-8000-000000000004',
  BARBELL_ROW: 'ex_a1b2c3d4-1005-4000-8000-000000000005',
  PULL_UP: 'ex_a1b2c3d4-1006-4000-8000-000000000006',
  PULL_UP_STRICT: 'ex_a1b2c3d4-1007-4000-8000-000000000007',
  PULL_UP_CHIN_UP: 'ex_a1b2c3d4-1008-4000-8000-000000000008',
  PULL_UP_WIDE_GRIP: 'ex_a1b2c3d4-1009-4000-8000-000000000009',
  PULL_UP_NEUTRAL_GRIP: 'ex_a1b2c3d4-1010-4000-8000-000000000010',
  PULL_UP_WEIGHTED: 'ex_a1b2c3d4-1011-4000-8000-000000000011',
  PULL_UP_L_SIT: 'ex_a1b2c3d4-1012-4000-8000-000000000012',
  PULL_UP_ARCHER: 'ex_a1b2c3d4-1013-4000-8000-000000000013',
  PULL_UP_COMMANDO: 'ex_a1b2c3d4-1014-4000-8000-000000000014',
  PULL_UP_KIPPING: 'ex_a1b2c3d4-1015-4000-8000-000000000015',
  PULL_UP_TOWEL: 'ex_a1b2c3d4-1016-4000-8000-000000000016',
  PULL_UP_MIXED_GRIP: 'ex_a1b2c3d4-1017-4000-8000-000000000017',
  PULL_UP_ECCENTRIC: 'ex_a1b2c3d4-1018-4000-8000-000000000018',
  PULL_UP_AROUND_THE_WORLD: 'ex_a1b2c3d4-1019-4000-8000-000000000019',
  PULL_UP_CHEST_TO_BAR: 'ex_a1b2c3d4-1020-4000-8000-000000000020',
  PULL_UP_ONE_ARM_ASSISTED: 'ex_a1b2c3d4-1021-4000-8000-000000000021',
  PUSH_UP: 'ex_a1b2c3d4-1022-4000-8000-000000000022',
  PUSH_UP_STRICT: 'ex_a1b2c3d4-1023-4000-8000-000000000023',
  PUSH_UP_WIDE: 'ex_a1b2c3d4-1024-4000-8000-000000000024',
  PUSH_UP_NARROW: 'ex_a1b2c3d4-1025-4000-8000-000000000025',
  PUSH_UP_DIAMOND: 'ex_a1b2c3d4-1026-4000-8000-000000000026',
  PUSH_UP_WEIGHTED: 'ex_a1b2c3d4-1027-4000-8000-000000000027',
  PUSH_UP_DECLINE: 'ex_a1b2c3d4-1028-4000-8000-000000000028',
  PUSH_UP_INCLINE: 'ex_a1b2c3d4-1029-4000-8000-000000000029',
  PUSH_UP_ARCHER: 'ex_a1b2c3d4-1030-4000-8000-000000000030',
  PUSH_UP_CLAPPING: 'ex_a1b2c3d4-1031-4000-8000-000000000031',
  PUSH_UP_PIKE: 'ex_a1b2c3d4-1032-4000-8000-000000000032',
  PUSH_UP_SPIDERMAN: 'ex_a1b2c3d4-1033-4000-8000-000000000033',
  PUSH_UP_ONE_ARM: 'ex_a1b2c3d4-1034-4000-8000-000000000034',
  PUSH_UP_ECCENTRIC: 'ex_a1b2c3d4-1035-4000-8000-000000000035',
  PUSH_UP_KNUCKLE: 'ex_a1b2c3d4-1036-4000-8000-000000000036',
  PUSH_UP_HINDU: 'ex_a1b2c3d4-1037-4000-8000-000000000037'
} as const;

export type DefaultExerciseId =
  (typeof DEFAULT_EXERCISE_IDS)[keyof typeof DEFAULT_EXERCISE_IDS];

const DEFAULT_EXERCISE_ID_SET = new Set<string>(
  Object.values(DEFAULT_EXERCISE_IDS)
);

/**
 * Check if an exercise ID is a default (translatable) exercise.
 */
export const isDefaultExercise = (id: string): id is DefaultExerciseId =>
  DEFAULT_EXERCISE_ID_SET.has(id);

interface DefaultExerciseDefinition {
  readonly id: DefaultExerciseId;
  /** Fallback English name stored in database */
  readonly name: string;
  readonly parentId?: DefaultExerciseId;
}

/**
 * Default exercises to seed in the database.
 * Parent exercises must appear before their children.
 * The `name` field is the English fallback stored in the database.
 * Translations are looked up by `id` at render time.
 */
export const DEFAULT_EXERCISES: readonly DefaultExerciseDefinition[] = [
  { id: DEFAULT_EXERCISE_IDS.BACK_SQUAT, name: 'Back Squat' },
  { id: DEFAULT_EXERCISE_IDS.BENCH_PRESS, name: 'Bench Press' },
  { id: DEFAULT_EXERCISE_IDS.DEADLIFT, name: 'Deadlift' },
  { id: DEFAULT_EXERCISE_IDS.OVERHEAD_PRESS, name: 'Overhead Press' },
  { id: DEFAULT_EXERCISE_IDS.BARBELL_ROW, name: 'Barbell Row' },
  { id: DEFAULT_EXERCISE_IDS.PULL_UP, name: 'Pull-Up' },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_STRICT,
    name: 'Strict Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_CHIN_UP,
    name: 'Chin-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_WIDE_GRIP,
    name: 'Wide Grip Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_NEUTRAL_GRIP,
    name: 'Neutral Grip Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_WEIGHTED,
    name: 'Weighted Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_L_SIT,
    name: 'L-Sit Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_ARCHER,
    name: 'Archer Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_COMMANDO,
    name: 'Commando Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_KIPPING,
    name: 'Kipping Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_TOWEL,
    name: 'Towel Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_MIXED_GRIP,
    name: 'Mixed Grip Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_ECCENTRIC,
    name: 'Eccentric Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_AROUND_THE_WORLD,
    name: 'Around-the-World Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_CHEST_TO_BAR,
    name: 'Chest-to-Bar Pull-Up',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PULL_UP_ONE_ARM_ASSISTED,
    name: 'One-Arm Pull-Up (Assisted)',
    parentId: DEFAULT_EXERCISE_IDS.PULL_UP
  },
  { id: DEFAULT_EXERCISE_IDS.PUSH_UP, name: 'Push-Up' },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_STRICT,
    name: 'Strict Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_WIDE,
    name: 'Wide Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_NARROW,
    name: 'Narrow Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_DIAMOND,
    name: 'Diamond Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_WEIGHTED,
    name: 'Weighted Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_DECLINE,
    name: 'Decline Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_INCLINE,
    name: 'Incline Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_ARCHER,
    name: 'Archer Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_CLAPPING,
    name: 'Clapping Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_PIKE,
    name: 'Pike Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_SPIDERMAN,
    name: 'Spiderman Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_ONE_ARM,
    name: 'One-Arm Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_ECCENTRIC,
    name: 'Eccentric Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_KNUCKLE,
    name: 'Knuckle Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  },
  {
    id: DEFAULT_EXERCISE_IDS.PUSH_UP_HINDU,
    name: 'Hindu Push-Up',
    parentId: DEFAULT_EXERCISE_IDS.PUSH_UP
  }
];
