import { Pool } from 'pg';
import { pgClientConfig, type Config } from './config';

const pool = new Pool(pgClientConfig('workshop'));

export default pool;

/** Build a fresh pool for one of the scoped roles. Used by background scripts. */
export function makePool(role: keyof Config['postgres']['roles']): Pool {
  return new Pool(pgClientConfig(role));
}
