import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { getClientIp } from './requestUtils.js';

describe('getClientIp', () => {
  it('returns IP from x-forwarded-for header when present', () => {
    const req = {
      get: vi.fn().mockReturnValue('192.168.1.1'),
      ip: '127.0.0.1'
    } as unknown as Request;

    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('returns first IP when x-forwarded-for has multiple IPs', () => {
    const req = {
      get: vi.fn().mockReturnValue('192.168.1.1, 10.0.0.1, 172.16.0.1'),
      ip: '127.0.0.1'
    } as unknown as Request;

    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('returns req.ip when x-forwarded-for is not present', () => {
    const req = {
      get: vi.fn().mockReturnValue(undefined),
      ip: '127.0.0.1'
    } as unknown as Request;

    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  it('returns unknown when x-forwarded-for is not present and req.ip is undefined', () => {
    const req = {
      get: vi.fn().mockReturnValue(undefined),
      ip: undefined
    } as unknown as Request;

    expect(getClientIp(req)).toBe('unknown');
  });

  it('returns req.ip when x-forwarded-for is empty string', () => {
    const req = {
      get: vi.fn().mockReturnValue(''),
      ip: '127.0.0.1'
    } as unknown as Request;

    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  it('handles comma with no IPs after split gracefully', () => {
    const req = {
      get: vi.fn().mockReturnValue(','),
      ip: '127.0.0.1'
    } as unknown as Request;

    expect(getClientIp(req)).toBe('127.0.0.1');
  });
});
