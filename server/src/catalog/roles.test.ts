import { describe, expect, it } from 'vitest';
import { canRunFullSync } from './roles.js';

describe('canRunFullSync', () => {
  it('allows roles that can see every post on the site', () => {
    expect(canRunFullSync('Owner')).toBe(true);
    expect(canRunFullSync('Administrator')).toBe(true);
    expect(canRunFullSync('Editor')).toBe(true);
  });

  it('refuses roles that only see their own posts', () => {
    // An Author's `browse` returns just their own posts, so a sync from that
    // role would prune every other contributor's references from the shared
    // catalog.
    expect(canRunFullSync('Author')).toBe(false);
    expect(canRunFullSync('Contributor')).toBe(false);
    expect(canRunFullSync('')).toBe(false);
    expect(canRunFullSync('Unknown')).toBe(false);
  });
});
