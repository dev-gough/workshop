import { Pool } from 'pg';
import { pgClientConfig, type Config } from './config';

const POOL_LIMITS = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 };

const pool = new Pool({ ...pgClientConfig('workshop'), ...POOL_LIMITS });

export default pool;

/** Build a fresh pool for one of the scoped roles. Used by background scripts. */
export function makePool(role: keyof Config['postgres']['roles']): Pool {
  return new Pool({ ...pgClientConfig(role), ...POOL_LIMITS });
}
