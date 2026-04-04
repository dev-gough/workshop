import { Pool } from 'pg';

const pool = new Pool({
  user: 'server',
  password: 'workshop',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

export default pool;
