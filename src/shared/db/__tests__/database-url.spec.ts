import { describe, expect, it } from 'vitest';
import { POOL } from '../../config/pool.js';
import { TIMINGS } from '../../config/timings.js';
import { describePool, withPoolParams } from '../database-url.js';

describe('withPoolParams', () => {
  it('fills every missing pool parameter from POOL and TIMINGS', () => {
    const out = withPoolParams('mysql://u:p@h:3306/db', POOL.db.api, TIMINGS.db);
    const params = new URL(out).searchParams;
    expect(params.get('connection_limit')).toBe('10');
    expect(params.get('pool_timeout')).toBe('10');
    expect(params.get('connect_timeout')).toBe('5');
    expect(params.get('socket_timeout')).toBe('5');
  });

  it('keeps the values the rendered URL already carries and adds only the missing ones', () => {
    const out = withPoolParams(
      'mysql://u:p@h:3306/db?connection_limit=3&pool_timeout=7',
      POOL.db.api,
      TIMINGS.db,
    );
    const params = new URL(out).searchParams;
    expect(params.get('connection_limit')).toBe('3');
    expect(params.get('pool_timeout')).toBe('7');
    expect(params.get('connect_timeout')).toBe('5');
    expect(params.get('socket_timeout')).toBe('5');
  });

  it('preserves an encoded password byte for byte', () => {
    const url = 'mysql://erp:p%40ss%3Aw%2Frd@127.0.0.1:33061/erp';
    const out = withPoolParams(url, POOL.db.api, TIMINGS.db);
    expect(new URL(out).password).toBe(new URL(url).password);
    expect(out.startsWith('mysql://erp:p%40ss%3Aw%2Frd@127.0.0.1:33061/erp?')).toBe(true);
  });

  it('is idempotent', () => {
    const once = withPoolParams('mysql://u:p@h/db', 4, TIMINGS.db);
    expect(withPoolParams(once, 99, TIMINGS.db)).toBe(once);
  });
});

describe('describePool', () => {
  it('reads the values when present and nulls when absent', () => {
    expect(describePool('mysql://u:p@h/db?connection_limit=10&pool_timeout=10')).toEqual({
      connectionLimit: 10,
      poolTimeoutS: 10,
    });
    expect(describePool('mysql://u:p@h/db')).toEqual({ connectionLimit: null, poolTimeoutS: null });
  });
});
