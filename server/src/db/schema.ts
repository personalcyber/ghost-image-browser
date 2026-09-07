// Catalog schema. Kept as a TS module (not a .sql file) so `tsc` output is
// self-contained and no asset-copy step is needed at build time.
export const SCHEMA_SQL = `
-- The catalog is a cache of what Ghost knows plus the notes Ghost cannot hold.
--
-- \`images\` and \`image_references\` are rebuilt from the site on every sync and
-- must never be the only copy of anything. \`image_metadata\` is the opposite:
-- it is user-authored, lives nowhere else, and is keyed on the image's stable
-- canonical path so it survives re-syncs, re-uploads and post deletions.

CREATE TABLE IF NOT EXISTS images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_url      TEXT NOT NULL,
  path          TEXT NOT NULL,
  url           TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  extension     TEXT NOT NULL DEFAULT '',
  is_internal   INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (site_url, path)
);

CREATE TABLE IF NOT EXISTS image_references (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id        INTEGER NOT NULL REFERENCES images (id) ON DELETE CASCADE,
  resource_type   TEXT NOT NULL,     -- 'post' | 'page'
  resource_id     TEXT NOT NULL,
  resource_title  TEXT,
  resource_slug   TEXT,
  resource_status TEXT,
  resource_url    TEXT,
  usage           TEXT NOT NULL,     -- 'feature_image' | 'content' | 'og_image' | 'twitter_image'
  -- Which sync run last saw this reference. Pruning compares against the
  -- current run's id rather than a timestamp, so two syncs inside the same
  -- millisecond cannot be mistaken for one.
  sync_run_id     INTEGER NOT NULL,
  UNIQUE (image_id, resource_type, resource_id, usage)
);

CREATE INDEX IF NOT EXISTS idx_refs_image ON image_references (image_id);
CREATE INDEX IF NOT EXISTS idx_refs_resource ON image_references (resource_type, resource_id);

-- Everything Ghost does not store about an image.
CREATE TABLE IF NOT EXISTS image_metadata (
  image_id    INTEGER PRIMARY KEY REFERENCES images (id) ON DELETE CASCADE,
  alt_text    TEXT NOT NULL DEFAULT '',
  caption     TEXT NOT NULL DEFAULT '',
  credit      TEXT NOT NULL DEFAULT '',
  license     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_url        TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL,  -- 'running' | 'ok' | 'error'
  posts_scanned   INTEGER NOT NULL DEFAULT 0,
  pages_scanned   INTEGER NOT NULL DEFAULT 0,
  images_found    INTEGER NOT NULL DEFAULT 0,
  references_found INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);
`;
