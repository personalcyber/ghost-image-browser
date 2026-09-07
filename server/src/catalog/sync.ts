import type { Database } from '../db/index.js';
import type { GhostAdminClient, GhostResourceType } from '../ghost/client.js';
import { extractImages, type GhostResource } from '../ghost/extract.js';
import { pruneStaleReferences, upsertImage, upsertReference } from './repo.js';

export interface SyncResult {
  siteUrl: string;
  startedAt: string;
  finishedAt: string;
  postsScanned: number;
  pagesScanned: number;
  imagesFound: number;
  referencesFound: number;
  staleReferencesRemoved: number;
}

/**
 * Subset of GhostAdminClient the sync needs, so tests can drive it with a stub
 * instead of a live Ghost site.
 */
export interface CatalogSource {
  readonly siteUrl: string;
  /** Other URLs that mean the same site; see `canonicalize` in ghost/urls.ts. */
  readonly siteAliases?: string[];
  browse(type: GhostResourceType): AsyncGenerator<GhostResource[]>;
}

const RESOURCE_TYPES: Array<{ type: GhostResourceType; singular: 'post' | 'page' }> = [
  { type: 'posts', singular: 'post' },
  { type: 'pages', singular: 'page' },
];

/**
 * Rebuilds the catalog for one site from its posts and pages.
 *
 * Every reference the run writes is stamped with the run's own id; anything
 * still carrying an older id afterwards no longer exists in Ghost and is
 * pruned. Images themselves are never deleted — that is deliberate, since the
 * user's own metadata hangs off them.
 */
export async function syncCatalog(
  db: Database,
  source: CatalogSource | GhostAdminClient,
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const siteUrl = source.siteUrl;
  const aliases = source.siteAliases ?? [];

  const run = db
    .prepare(`INSERT INTO sync_runs (site_url, started_at, status) VALUES (?, ?, 'running')`)
    .run(siteUrl, startedAt);
  const runId = Number(run.lastInsertRowid);

  const counts = { post: 0, page: 0 };
  const seenImages = new Set<string>();
  let referencesFound = 0;

  try {
    for (const { type, singular } of RESOURCE_TYPES) {
      for await (const batch of source.browse(type)) {
        for (const resource of batch) {
          counts[singular] += 1;

          for (const { image, usage } of extractImages(resource, siteUrl, aliases)) {
            const imageId = upsertImage(db, siteUrl, image, startedAt);
            seenImages.add(image.path);
            upsertReference(
              db,
              imageId,
              {
                resourceType: singular,
                resourceId: resource.id,
                resourceTitle: resource.title ?? null,
                resourceSlug: resource.slug ?? null,
                resourceStatus: resource.status ?? null,
                resourceUrl: resource.url ?? null,
                usage,
              },
              runId,
            );
            referencesFound += 1;
          }
        }
      }
    }

    const staleReferencesRemoved = pruneStaleReferences(db, siteUrl, runId);
    const finishedAt = new Date().toISOString();

    db.prepare(
      `UPDATE sync_runs
       SET finished_at = ?, status = 'ok', posts_scanned = ?, pages_scanned = ?,
           images_found = ?, references_found = ?
       WHERE id = ?`,
    ).run(finishedAt, counts.post, counts.page, seenImages.size, referencesFound, runId);

    return {
      siteUrl,
      startedAt,
      finishedAt,
      postsScanned: counts.post,
      pagesScanned: counts.page,
      imagesFound: seenImages.size,
      referencesFound,
      staleReferencesRemoved,
    };
  } catch (error) {
    db.prepare(
      `UPDATE sync_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?`,
    ).run(new Date().toISOString(), error instanceof Error ? error.message : String(error), runId);
    throw error;
  }
}

export interface LastSync {
  startedAt: string;
  finishedAt: string | null;
  status: string;
  postsScanned: number;
  pagesScanned: number;
  imagesFound: number;
  error: string | null;
}

export function getLastSync(db: Database, siteUrl: string): LastSync | null {
  const row = db
    .prepare(
      `SELECT started_at, finished_at, status, posts_scanned, pages_scanned, images_found, error
       FROM sync_runs WHERE site_url = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(siteUrl) as unknown as
    | {
        started_at: string;
        finished_at: string | null;
        status: string;
        posts_scanned: number;
        pages_scanned: number;
        images_found: number;
        error: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    postsScanned: row.posts_scanned,
    pagesScanned: row.pages_scanned,
    imagesFound: row.images_found,
    error: row.error,
  };
}
