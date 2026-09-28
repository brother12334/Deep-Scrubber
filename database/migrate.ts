import { Database } from "./db";
import { migrate } from "./migrator";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/deepscrubber";
const cmd = process.argv[2] ?? "up";

if (cmd !== "up") {
  console.error("Only forward migrations are supported: `migrate up`");
  process.exit(1);
}
const db = new Database(url, 1);
migrate(db, undefined, (m) => console.log(m))
  .then((applied) => console.log(applied.length ? `applied ${applied.length} migration(s)` : "database up to date"))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
