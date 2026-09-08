import { describe, expect, it } from 'vitest';
import { describeSync, describeUsage, pluralize } from './format';
import type { LastSync } from '../types';

function sync(overrides: Partial<LastSync> = {}): LastSync {
  return {
    startedAt: '2026-01-01T10:00:00.000Z',
    finishedAt: '2026-01-01T10:00:05.000Z',
    status: 'ok',
    postsScanned: 2,
    pagesScanned: 1,
    imagesFound: 7,
    error: null,
    ...overrides,
  };
}

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'page')).toBe('1 page');
    expect(pluralize(0, 'page')).toBe('0 pages');
    expect(pluralize(2, 'page')).toBe('2 pages');
  });
});

describe('describeSync', () => {
  it('reports when the site has never been scanned', () => {
    expect(describeSync(null)).toBe('Never synced');
  });

  it('pluralizes the scanned counts independently', () => {
    expect(describeSync(sync())).toContain('2 posts, 1 page');
  });

  it('surfaces the failure instead of a misleading timestamp', () => {
    expect(describeSync(sync({ status: 'error', error: 'Authorization failed' }))).toBe(
      'Last sync failed: Authorization failed',
    );
  });
});

describe('describeUsage', () => {
  it('names the empty case rather than counting to zero', () => {
    expect(describeUsage(0)).toBe('Unused');
    expect(describeUsage(1)).toBe('1 use');
    expect(describeUsage(3)).toBe('3 uses');
  });
});
