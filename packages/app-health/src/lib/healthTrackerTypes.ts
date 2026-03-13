/**
 * Types for health tracker.
 */

export type WeightUnit = 'lb' | 'kg';

export interface WeightReading {
  id: string;
  recordedAt: string;
  value: number;
  unit: WeightUnit;
  note?: string;
  contactId: string | null;
}

export interface CreateWeightReadingInput {
  recordedAt: string | Date;
  value: number;
  unit?: WeightUnit;
  note?: string;
  contactId?: string | null;
}

export interface BloodPressureReading {
  id: string;
  recordedAt: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  note?: string;
  contactId: string | null;
}

export interface CreateBloodPressureReadingInput {
  recordedAt: string | Date;
  systolic: number;
  diastolic: number;
  pulse?: number;
  note?: string;
  contactId?: string | null;
}

export interface Exercise {
  id: string;
  name: string;
  parentId?: string;
  parentName?: string;
}

export interface CreateExerciseInput {
  id?: string;
  name: string;
  parentId?: string;
}

export interface WorkoutEntry {
  id: string;
  performedAt: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
  note?: string;
  contactId: string | null;
}

export interface CreateWorkoutEntryInput {
  performedAt: string | Date;
  exerciseId: string;
  reps: number;
  weight: number;
  weightUnit?: WeightUnit;
  note?: string;
  contactId?: string | null;
}

export type HealthReadingTable =
  | 'health_weight_readings'
  | 'health_blood_pressure_readings'
  | 'health_workout_entries';

export interface HealthTracker {
  listExercises: () => Promise<Exercise[]>;
  listParentExercises: () => Promise<Exercise[]>;
  listChildExercises: (parentId: string) => Promise<Exercise[]>;
  getExerciseHierarchy: () => Promise<Map<string, Exercise[]>>;
  addExercise: (input: CreateExerciseInput) => Promise<Exercise>;
  listWeightReadings: () => Promise<WeightReading[]>;
  addWeightReading: (input: CreateWeightReadingInput) => Promise<WeightReading>;
  listBloodPressureReadings: () => Promise<BloodPressureReading[]>;
  addBloodPressureReading: (
    input: CreateBloodPressureReadingInput
  ) => Promise<BloodPressureReading>;
  listWorkoutEntries: () => Promise<WorkoutEntry[]>;
  addWorkoutEntry: (input: CreateWorkoutEntryInput) => Promise<WorkoutEntry>;
  updateContactId: (
    table: HealthReadingTable,
    id: string,
    contactId: string | null
  ) => Promise<void>;
}

export interface CreateHealthTrackerOptions {
  createId?: (prefix: string) => string;
  now?: () => Date;
}
