import { Pool } from 'pg';

const pool = new Pool({
  user: 'workshop',
  password: 'workshop',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

export default pool;
