import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../db/index.js';
import type { GhostResource } from '../ghost/extract.js';
import type { GhostResourceType } from '../ghost/client.js';
import { getImage, listImages, saveMetadata } from './repo.js';
import { syncCatalog, type CatalogSource } from './sync.js';

const SITE = 'https://blog.example.com';

/** Stands in for a Ghost site so the sync can be tested without the network. */
function fakeSource(
  posts: GhostResource[],
  pages: GhostResource[] = [],
  siteAliases: string[] = [],
): CatalogSource {
  return {
    siteUrl: SITE,
    siteAliases,
    async *browse(type: GhostResourceType) {
      const items = type === 'posts' ? posts : pages;
      if (items.length > 0) yield items;
    },
  };
}

function post(id: string, overrides: Partial<GhostResource> = {}): GhostResource {
  return { id, title: `Post ${id}`, slug: id, status: 'published', ...overrides };
}

describe('syncCatalog', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('catalogs images from posts and pages with their references', async () => {
    const result = await syncCatalog(
      db,
      fakeSource(
        [post('p1', { feature_image: `${SITE}/content/images/2024/01/hero.jpg` })],
        [post('pg1', { html: '<img src="/content/images/2024/01/hero.jpg">' })],
      ),
    );

    expect(result.postsScanned).toBe(1);
    expect(result.pagesScanned).toBe(1);
    expect(result.imagesFound).toBe(1);
    expect(result.referencesFound).toBe(2);

    const [image] = listImages(db, { siteUrl: SITE });
    expect(image!.referenceCount).toBe(2);

    const detail = getImage(db, SITE, image!.id)!;
    expect(detail.references.map((ref) => `${ref.resourceType}:${ref.usage}`).sort()).toEqual([
      'page:content',
      'post:feature_image',
    ]);
  });

  it('does not double-count an image Ghost stores under its configured URL', async () => {
    // Regression: signing in through one host while Ghost's `url` config names
    // another produced two catalog rows for a single upload.
    await syncCatalog(
      db,
      fakeSource(
        [
          post('p1', {
            feature_image: 'https://www.example.com/content/images/2024/01/hero.jpg',
            html: '<img src="/content/images/2024/01/hero.jpg">',
          }),
        ],
        [],
        ['https://www.example.com'],
      ),
    );

    const images = listImages(db, { siteUrl: SITE });
    expect(images).toHaveLength(1);
    expect(images[0]!.isInternal).toBe(true);
    expect(images[0]!.referenceCount).toBe(2);
  });

  it('is idempotent across repeated runs', async () => {
    const source = fakeSource([post('p1', { html: '<img src="/content/images/a.jpg">' })]);
    await syncCatalog(db, source);
    await syncCatalog(db, source);

    const images = listImages(db, { siteUrl: SITE });
    expect(images).toHaveLength(1);
    expect(images[0]!.referenceCount).toBe(1);
  });

  it('drops references to images a post no longer uses, keeping the image', async () => {
    await syncCatalog(db, fakeSource([post('p1', { html: '<img src="/content/images/a.jpg">' })]));
    const result = await syncCatalog(db, fakeSource([post('p1', { html: '<p>no images</p>' })]));

    expect(result.staleReferencesRemoved).toBe(1);
    const [image] = listImages(db, { siteUrl: SITE });
    expect(image!.referenceCount).toBe(0);
    expect(listImages(db, { siteUrl: SITE, unusedOnly: true })).toHaveLength(1);
  });

  it('preserves user metadata across a re-sync', async () => {
    const source = fakeSource([post('p1', { html: '<img src="/content/images/a.jpg">' })]);
    await syncCatalog(db, source);

    const [image] = listImages(db, { siteUrl: SITE });
    saveMetadata(
      db,
      image!.id,
      { notes: 'Licensed for print until 2027', tags: ['brand', 'hero'] },
      new Date().toISOString(),
    );

    await syncCatalog(db, source);

    const detail = getImage(db, SITE, image!.id)!;
    expect(detail.metadata.notes).toBe('Licensed for print until 2027');
    expect(detail.metadata.tags).toEqual(['brand', 'hero']);
  });

  it('records a failed run instead of leaving it marked running', async () => {
    const failing: CatalogSource = {
      siteUrl: SITE,
      // eslint-disable-next-line require-yield
      async *browse() {
        throw new Error('Ghost is down');
      },
    };

    await expect(syncCatalog(db, failing)).rejects.toThrow('Ghost is down');
    const run = db
      .prepare('SELECT status, error FROM sync_runs ORDER BY id DESC LIMIT 1')
      .get() as {
      status: string;
      error: string;
    };
    expect(run.status).toBe('error');
    expect(run.error).toBe('Ghost is down');
  });
});
