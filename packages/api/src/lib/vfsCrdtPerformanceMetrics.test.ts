import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVfsCrdtQueryMetrics,
  emitVfsCrdtRoutePerfMetric,
  mergeVfsCrdtQueryMetrics,
  runTimedVfsCrdtQuery
} from './vfsCrdtPerformanceMetrics.js';

describe('vfsCrdtPerformanceMetrics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env['VFS_CRDT_PERF_METRICS'];
  });

  it('creates empty query metric accumulators', () => {
    expect(createVfsCrdtQueryMetrics()).toEqual({
      count: 0,
      durationMs: 0,
      durationByLabel: {},
      rowCountByLabel: {}
    });
  });

  it('records query duration + row count on success', async () => {
    const metrics = createVfsCrdtQueryMetrics();
    const result = await runTimedVfsCrdtQuery(
      'pull_page',
      metrics,
      async () => ({
        rowCount: 2,
        rows: [{ id: 1 }, { id: 2 }]
      })
    );

    expect(result.rowCount).toBe(2);
    expect(metrics.count).toBe(1);
    expect(metrics.durationByLabel['pull_page']).toBeGreaterThanOrEqual(0);
    expect(metrics.rowCountByLabel['pull_page']).toBe(2);
  });

  it('falls back to rows length when rowCount is missing', async () => {
    const metrics = createVfsCrdtQueryMetrics();
    await runTimedVfsCrdtQuery('replica_write_ids', metrics, async () => ({
      rows: [{ replica_id: 'desktop' }, { replica_id: 'mobile' }]
    }));

    expect(metrics.rowCountByLabel['replica_write_ids']).toBe(2);
  });

  it('records failed query attempts and rethrows errors', async () => {
    const metrics = createVfsCrdtQueryMetrics();

    await expect(
      runTimedVfsCrdtQuery('insert_crdt_op', metrics, async () => {
        throw new Error('insert failed');
      })
    ).rejects.toThrow('insert failed');

    expect(metrics.count).toBe(1);
    expect(metrics.durationByLabel['insert_crdt_op']).toBeGreaterThanOrEqual(0);
    expect(metrics.rowCountByLabel['insert_crdt_op']).toBe(0);
  });

  it('merges per-label and aggregate metrics', () => {
    const left = createVfsCrdtQueryMetrics();
    left.count = 1;
    left.durationMs = 1.5;
    left.durationByLabel['begin'] = 1.5;
    left.rowCountByLabel['begin'] = 0;

    const right = createVfsCrdtQueryMetrics();
    right.count = 2;
    right.durationMs = 3;
    right.durationByLabel['pull_page'] = 2;
    right.durationByLabel['replica_write_ids'] = 1;
    right.rowCountByLabel['pull_page'] = 4;
    right.rowCountByLabel['replica_write_ids'] = 2;

    expect(mergeVfsCrdtQueryMetrics(left, right)).toEqual({
      count: 3,
      durationMs: 4.5,
      durationByLabel: {
        begin: 1.5,
        pull_page: 2,
        replica_write_ids: 1
      },
      rowCountByLabel: {
        begin: 0,
        pull_page: 4,
        replica_write_ids: 2
      }
    });
  });

  it('emits route metrics when enabled', () => {
    process.env['VFS_CRDT_PERF_METRICS'] = 'true';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const queryMetrics = createVfsCrdtQueryMetrics();
    queryMetrics.count = 2;
    queryMetrics.durationMs = 3.4567;
    queryMetrics.durationByLabel['begin'] = 1.2345;
    queryMetrics.durationByLabel['commit'] = 2.2222;
    queryMetrics.rowCountByLabel['begin'] = 0;
    queryMetrics.rowCountByLabel['commit'] = 1;

    emitVfsCrdtRoutePerfMetric({
      route: 'push',
      success: true,
      durationMs: 12.3456,
      queryMetrics,
      operationCount: 3,
      resultCount: 3
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(infoSpy.mock.calls[0]?.[0]));
    expect(payload.event).toBe('vfs_crdt_route_perf');
    expect(payload.route).toBe('push');
    expect(payload.success).toBe(true);
    expect(payload.durationMs).toBe(12.346);
    expect(payload.queryDurationMs).toBe(3.457);
    expect(payload.queryDurationByLabel).toEqual({
      begin: 1.235,
      commit: 2.222
    });
    expect(payload.queryRowCountByLabel).toEqual({
      begin: 0,
      commit: 1
    });
  });

  it('does not emit in test env unless explicitly enabled', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    emitVfsCrdtRoutePerfMetric({
      route: 'pull',
      success: true,
      durationMs: 1,
      queryMetrics: createVfsCrdtQueryMetrics()
    });

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('does not throw on invalid env value and logs an error', () => {
    process.env['VFS_CRDT_PERF_METRICS'] = 'maybe';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      emitVfsCrdtRoutePerfMetric({
        route: 'session',
        success: false,
        durationMs: 1,
        queryMetrics: createVfsCrdtQueryMetrics(),
        error: new Error('boom')
      })
    ).not.toThrow();

    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      'Invalid VFS_CRDT_PERF_METRICS value'
    );
  });
});
