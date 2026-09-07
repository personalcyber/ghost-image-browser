import type { Database } from '../db/index.js';
import type { CanonicalImage } from '../ghost/urls.js';
import type { ImageUsage } from '../ghost/extract.js';

export interface ImageMetadata {
  altText: string;
  caption: string;
  credit: string;
  license: string;
  notes: string;
  tags: string[];
  updatedAt: string | null;
}

export interface ImageSummary {
  id: number;
  url: string;
  path: string;
  fileName: string;
  extension: string;
  isInternal: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  referenceCount: number;
  metadata: ImageMetadata;
}

export interface ImageReference {
  resourceType: 'post' | 'page';
  resourceId: string;
  resourceTitle: string | null;
  resourceSlug: string | null;
  resourceStatus: string | null;
  resourceUrl: string | null;
  usage: ImageUsage;
}

export interface ImageDetail extends ImageSummary {
  references: ImageReference[];
}

export interface ListImagesOptions {
  siteUrl: string;
  /** Case-insensitive match against file name, path, and the user's own notes. */
  query?: string;
  usage?: ImageUsage;
  /** Only images no post or page currently references. */
  unusedOnly?: boolean;
  /** Only images hosted by the Ghost site (excludes Unsplash and other CDNs). */
  internalOnly?: boolean;
  limit?: number;
  offset?: number;
}

const EMPTY_METADATA: ImageMetadata = {
  altText: '',
  caption: '',
  credit: '',
  license: '',
  notes: '',
  tags: [],
  updatedAt: null,
};

interface ImageRow {
  id: number;
  url: string;
  path: string;
  file_name: string;
  extension: string;
  is_internal: number;
  first_seen_at: string;
  last_seen_at: string;
  reference_count: number;
  alt_text: string | null;
  caption: string | null;
  credit: string | null;
  license: string | null;
  notes: string | null;
  tags: string | null;
  metadata_updated_at: string | null;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

function toSummary(row: ImageRow): ImageSummary {
  return {
    id: row.id,
    url: row.url,
    path: row.path,
    fileName: row.file_name,
    extension: row.extension,
    isInternal: row.is_internal === 1,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    referenceCount: row.reference_count,
    metadata: {
      altText: row.alt_text ?? '',
      caption: row.caption ?? '',
      credit: row.credit ?? '',
      license: row.license ?? '',
      notes: row.notes ?? '',
      tags: parseTags(row.tags),
      updatedAt: row.metadata_updated_at,
    },
  };
}

const SELECT_IMAGE = `
  SELECT i.id, i.url, i.path, i.file_name, i.extension, i.is_internal,
         i.first_seen_at, i.last_seen_at,
         (SELECT COUNT(*) FROM image_references r WHERE r.image_id = i.id) AS reference_count,
         m.alt_text, m.caption, m.credit, m.license, m.notes, m.tags,
         m.updated_at AS metadata_updated_at
  FROM images i
  LEFT JOIN image_metadata m ON m.image_id = i.id
`;

/**
 * Inserts the image or refreshes `last_seen_at`, returning its id.
 *
 * Rows are keyed on (site_url, canonical path) rather than on anything Ghost
 * assigns, which is what lets user metadata outlive the post that first
 * introduced the image.
 */
export function upsertImage(
  db: Database,
  siteUrl: string,
  image: CanonicalImage,
  now: string,
): number {
  db.prepare(
    `INSERT INTO images (site_url, path, url, file_name, extension, is_internal, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site_url, path) DO UPDATE SET
       url = excluded.url,
       file_name = excluded.file_name,
       extension = excluded.extension,
       is_internal = excluded.is_internal,
       last_seen_at = excluded.last_seen_at`,
  ).run(
    siteUrl,
    image.path,
    image.url,
    image.fileName,
    image.extension,
    image.internal ? 1 : 0,
    now,
    now,
  );

  const row = db
    .prepare('SELECT id FROM images WHERE site_url = ? AND path = ?')
    .get(siteUrl, image.path) as { id: number } | undefined;

  if (!row) throw new Error(`Failed to upsert image ${image.path}`);
  return row.id;
}

export function upsertReference(
  db: Database,
  imageId: number,
  reference: ImageReference,
  syncRunId: number,
): void {
  db.prepare(
    `INSERT INTO image_references
       (image_id, resource_type, resource_id, resource_title, resource_slug,
        resource_status, resource_url, usage, sync_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (image_id, resource_type, resource_id, usage) DO UPDATE SET
       resource_title = excluded.resource_title,
       resource_slug = excluded.resource_slug,
       resource_status = excluded.resource_status,
       resource_url = excluded.resource_url,
       sync_run_id = excluded.sync_run_id`,
  ).run(
    imageId,
    reference.resourceType,
    reference.resourceId,
    reference.resourceTitle,
    reference.resourceSlug,
    reference.resourceStatus,
    reference.resourceUrl,
    reference.usage,
    syncRunId,
  );
}

/**
 * Drops references that the given sync run did not re-record.
 *
 * This is how deletions propagate: an image removed from a post keeps its
 * catalog row (and its notes) but loses the reference, so it shows up under the
 * "unused" filter instead of silently claiming a use that no longer exists.
 */
export function pruneStaleReferences(db: Database, siteUrl: string, syncRunId: number): number {
  const result = db
    .prepare(
      `DELETE FROM image_references
       WHERE sync_run_id <> ?
         AND image_id IN (SELECT id FROM images WHERE site_url = ?)`,
    )
    .run(syncRunId, siteUrl);
  return Number(result.changes);
}

export function listImages(db: Database, options: ListImagesOptions): ImageSummary[] {
  const where: string[] = ['i.site_url = ?'];
  const params: Array<string | number> = [options.siteUrl];

  if (options.query) {
    where.push('(i.file_name LIKE ? OR i.path LIKE ? OR m.notes LIKE ? OR m.caption LIKE ?)');
    const like = `%${options.query}%`;
    params.push(like, like, like, like);
  }
  if (options.usage) {
    where.push('EXISTS (SELECT 1 FROM image_references r WHERE r.image_id = i.id AND r.usage = ?)');
    params.push(options.usage);
  }
  if (options.unusedOnly) {
    where.push('NOT EXISTS (SELECT 1 FROM image_references r WHERE r.image_id = i.id)');
  }
  if (options.internalOnly) where.push('i.is_internal = 1');

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = db
    .prepare(
      `${SELECT_IMAGE} WHERE ${where.join(' AND ')}
       ORDER BY reference_count DESC, i.file_name ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as unknown as ImageRow[];

  return rows.map(toSummary);
}

export function countImages(db: Database, siteUrl: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM images WHERE site_url = ?')
    .get(siteUrl) as { total: number };
  return row.total;
}

export function getImage(db: Database, siteUrl: string, id: number): ImageDetail | null {
  const row = db
    .prepare(`${SELECT_IMAGE} WHERE i.site_url = ? AND i.id = ?`)
    .get(siteUrl, id) as unknown as ImageRow | undefined;
  if (!row) return null;

  const references = db
    .prepare(
      `SELECT resource_type, resource_id, resource_title, resource_slug,
              resource_status, resource_url, usage
       FROM image_references WHERE image_id = ?
       ORDER BY resource_type, resource_title`,
    )
    .all(id) as unknown as Array<{
    resource_type: 'post' | 'page';
    resource_id: string;
    resource_title: string | null;
    resource_slug: string | null;
    resource_status: string | null;
    resource_url: string | null;
    usage: ImageUsage;
  }>;

  return {
    ...toSummary(row),
    references: references.map((reference) => ({
      resourceType: reference.resource_type,
      resourceId: reference.resource_id,
      resourceTitle: reference.resource_title,
      resourceSlug: reference.resource_slug,
      resourceStatus: reference.resource_status,
      resourceUrl: reference.resource_url,
      usage: reference.usage,
    })),
  };
}

/** Merges a partial metadata patch; omitted fields keep their stored value. */
export function saveMetadata(
  db: Database,
  imageId: number,
  patch: Partial<Omit<ImageMetadata, 'updatedAt'>>,
  now: string,
): ImageMetadata {
  const current =
    (db
      .prepare(
        'SELECT alt_text, caption, credit, license, notes, tags FROM image_metadata WHERE image_id = ?',
      )
      .get(imageId) as unknown as Partial<ImageRow> | undefined) ?? {};

  const merged: Omit<ImageMetadata, 'updatedAt'> = {
    altText: patch.altText ?? current.alt_text ?? EMPTY_METADATA.altText,
    caption: patch.caption ?? current.caption ?? EMPTY_METADATA.caption,
    credit: patch.credit ?? current.credit ?? EMPTY_METADATA.credit,
    license: patch.license ?? current.license ?? EMPTY_METADATA.license,
    notes: patch.notes ?? current.notes ?? EMPTY_METADATA.notes,
    tags: patch.tags ?? parseTags(current.tags ?? null),
  };

  db.prepare(
    `INSERT INTO image_metadata (image_id, alt_text, caption, credit, license, notes, tags, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (image_id) DO UPDATE SET
       alt_text = excluded.alt_text,
       caption = excluded.caption,
       credit = excluded.credit,
       license = excluded.license,
       notes = excluded.notes,
       tags = excluded.tags,
       updated_at = excluded.updated_at`,
  ).run(
    imageId,
    merged.altText,
    merged.caption,
    merged.credit,
    merged.license,
    merged.notes,
    JSON.stringify(merged.tags),
    now,
  );

  return { ...merged, updatedAt: now };
}
