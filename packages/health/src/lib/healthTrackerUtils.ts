/**
 * Utility functions for health tracker.
 */

import type { WeightUnit } from './healthTrackerTypes.js';

const NON_ALPHANUMERIC_REGEX = /[^a-z0-9]+/g;
const EDGE_DASHES_REGEX = /^-+|-+$/g;
const WEIGHT_SCALE = 100;

export const normalizeRequiredText = (
  value: string,
  fieldName: string
): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }

  return normalized;
};

export const normalizeOptionalText = (
  value: string | undefined
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized;
};

export const normalizeTimestamp = (
  value: string | Date,
  fieldName: string
): Date => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) {
      throw new Error(`${fieldName} must be a valid date`);
    }

    return new Date(timestamp);
  }

  const normalized = normalizeRequiredText(value, fieldName);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return new Date(timestamp);
};

export const normalizePositiveNumber = (
  value: number,
  fieldName: string
): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }

  return value;
};

export const normalizeNonNegativeNumber = (
  value: number,
  fieldName: string
): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }

  return value;
};

export const normalizePositiveInteger = (
  value: number,
  fieldName: string
): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value;
};

export const normalizeWeightUnit = (
  value: WeightUnit | undefined,
  fieldName: string
): WeightUnit => {
  const normalized = value ?? 'lb';
  if (normalized !== 'lb' && normalized !== 'kg') {
    throw new Error(`${fieldName} must be either "lb" or "kg"`);
  }

  return normalized;
};

export const createSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_REGEX, '-')
    .replace(EDGE_DASHES_REGEX, '');

export const toIsoTimestamp = (value: Date): string => {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error('timestamp must be valid');
  }

  return new Date(timestamp).toISOString();
};

export const toCentiWeight = (value: number, fieldName: string): number =>
  Math.round(normalizePositiveNumber(value, fieldName) * WEIGHT_SCALE);

export const toCentiWeightAllowZero = (
  value: number,
  fieldName: string
): number =>
  Math.round(normalizeNonNegativeNumber(value, fieldName) * WEIGHT_SCALE);

export const fromCentiWeight = (value: number): number => value / WEIGHT_SCALE;
