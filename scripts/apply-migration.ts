/**
 * One-off migration applier for the schema additions in this branch:
 *   - part.folder_id column + index
 *   - folder table
 *   - route_template + route_template_step tables (+ indexes)
 *
 * Idempotent: safe to re-run. Uses `better-sqlite3` directly to dodge the
 * `drizzle-kit push` ordering bug where it builds the index before the column.
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const db = new Database(resolve(process.cwd(), "data/spike.db"));

function exec(sql: string) {
  try {
    db.exec(sql);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("duplicate column") ||
        err.message.includes("already exists"))
    ) {
      // Idempotent — already applied.
      return;
    }
    throw err;
  }
}

const partColumns = db
  .prepare("PRAGMA table_info('part')")
  .all() as Array<{ name: string }>;
const hasFolderId = partColumns.some((c) => c.name === "folder_id");
if (!hasFolderId) {
  exec(`ALTER TABLE part ADD COLUMN folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL`);
}

exec(`
  CREATE TABLE IF NOT EXISTS folder (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    color        TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

exec(`
  CREATE TABLE IF NOT EXISTS route_template (
    id                  TEXT PRIMARY KEY,
    key                 TEXT NOT NULL UNIQUE,
    label               TEXT NOT NULL,
    description         TEXT,
    is_builtin          INTEGER NOT NULL DEFAULT 0,
    is_auto_detectable  INTEGER NOT NULL DEFAULT 0,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

exec(`
  CREATE TABLE IF NOT EXISTS route_template_step (
    id           TEXT PRIMARY KEY,
    template_id  TEXT NOT NULL REFERENCES route_template(id) ON DELETE CASCADE,
    sequence     INTEGER NOT NULL,
    name         TEXT NOT NULL,
    machine_kind TEXT NOT NULL,
    est_minutes  INTEGER NOT NULL DEFAULT 15
  );
`);

exec(`CREATE INDEX IF NOT EXISTS part_folder_idx ON part(folder_id)`);
exec(`CREATE INDEX IF NOT EXISTS route_template_key_idx ON route_template(key)`);
exec(`CREATE INDEX IF NOT EXISTS template_step_template_idx ON route_template_step(template_id)`);
exec(`CREATE INDEX IF NOT EXISTS template_step_sequence_idx ON route_template_step(sequence)`);

// Add machine_id to route_template_step (preferred machine override)
const stepCols = db
  .prepare("PRAGMA table_info('route_template_step')")
  .all() as Array<{ name: string }>;
if (!stepCols.some((c) => c.name === "machine_id")) {
  exec(
    `ALTER TABLE route_template_step ADD COLUMN machine_id TEXT REFERENCES machine(id) ON DELETE SET NULL`,
  );
  // Backfill: pick the first machine matching the step's kind so existing
  // templates keep working with specific machine references.
  exec(`
    UPDATE route_template_step
    SET machine_id = (
      SELECT id FROM machine
      WHERE machine.kind = route_template_step.machine_kind
      LIMIT 1
    )
    WHERE machine_id IS NULL
  `);
}
exec(
  `CREATE INDEX IF NOT EXISTS template_step_machine_idx ON route_template_step(machine_id)`,
);

console.log("Schema additions applied.");
db.close();
