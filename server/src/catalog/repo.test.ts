import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../db/index.js';
import { canonicalize } from '../ghost/urls.js';
import { getImage, listImages, saveMetadata, upsertImage, upsertReference } from './repo.js';

const SITE = 'https://blog.example.com';
const NOW = '2026-01-01T00:00:00.000Z';

function seed(db: Database, path: string, options: { referenced?: boolean; notes?: string } = {}) {
  const image = canonicalize(`${SITE}${path}`, SITE)!;
  const id = upsertImage(db, SITE, image, NOW);
  if (options.referenced) {
    upsertReference(
      db,
      id,
      {
        resourceType: 'post',
        resourceId: 'p1',
        resourceTitle: 'A post',
        resourceSlug: 'a-post',
        resourceStatus: 'published',
        resourceUrl: `${SITE}/a-post/`,
        usage: 'content',
      },
      1,
    );
  }
  if (options.notes) saveMetadata(db, id, { notes: options.notes }, NOW);
  return id;
}

describe('catalog queries', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('filters to unused images', () => {
    seed(db, '/content/images/used.jpg', { referenced: true });
    seed(db, '/content/images/orphan.jpg');

    const unused = listImages(db, { siteUrl: SITE, unusedOnly: true });
    expect(unused.map((image) => image.fileName)).toEqual(['orphan.jpg']);
  });

  it('searches file names and the user notes Ghost does not store', () => {
    seed(db, '/content/images/dsc00194.jpg', { notes: 'Head shot of the founder' });
    seed(db, '/content/images/chart.png');

    expect(listImages(db, { siteUrl: SITE, query: 'founder' })).toHaveLength(1);
    expect(listImages(db, { siteUrl: SITE, query: 'chart' })).toHaveLength(1);
  });

  it('excludes third-party images when asked', () => {
    seed(db, '/content/images/local.jpg');
    upsertImage(db, SITE, canonicalize('https://images.unsplash.com/photo-1.jpg', SITE)!, NOW);

    expect(listImages(db, { siteUrl: SITE })).toHaveLength(2);
    expect(listImages(db, { siteUrl: SITE, internalOnly: true })).toHaveLength(1);
  });

  it('scopes reads to the signed-in site', () => {
    const id = seed(db, '/content/images/local.jpg');
    expect(getImage(db, 'https://other.example.com', id)).toBeNull();
  });

  it('merges metadata patches instead of clearing omitted fields', () => {
    const id = seed(db, '/content/images/local.jpg');
    saveMetadata(db, id, { credit: 'Jane Roe', tags: ['team'] }, NOW);
    const merged = saveMetadata(db, id, { notes: 'Updated' }, NOW);

    expect(merged.credit).toBe('Jane Roe');
    expect(merged.tags).toEqual(['team']);
    expect(merged.notes).toBe('Updated');
  });
});
