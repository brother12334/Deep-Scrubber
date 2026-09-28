import pg from "pg";

// Return numerics as JS numbers (scores/confidences fit comfortably).
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

export type Queryable = Pick<pg.PoolClient, "query">;

export class Database {
  readonly pool: pg.Pool;

  constructor(connectionString: string, max = 10) {
    this.pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  }

  async query<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
    client: Queryable = this.pool,
  ): Promise<T[]> {
    const res = await client.query<T>(text, params);
    return res.rows;
  }

  async one<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
    client: Queryable = this.pool,
  ): Promise<T | undefined> {
    const rows = await this.query<T>(text, params, client);
    return rows[0];
  }

  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
