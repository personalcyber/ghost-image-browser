import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './schema.js';

export type Database = DatabaseSync;

/**
 * Opens the catalog database and applies the schema.
 *
 * `node:sqlite` is used instead of a native driver so the project installs with
 * no compile step; it prints an ExperimentalWarning on Node 22, which is
 * expected. Pass ':memory:' in tests.
 */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}
