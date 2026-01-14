import { vi } from 'vitest';
import { createClient } from './redis-mock.js';

vi.mock('redis', () => ({
  createClient
}));
