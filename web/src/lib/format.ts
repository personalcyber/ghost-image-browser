import type { LastSync } from '../types';

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** One-line summary of the last sync, for the toolbar. */
export function describeSync(lastSync: LastSync | null): string {
  if (!lastSync) return 'Never synced';
  if (lastSync.status === 'error') return `Last sync failed: ${lastSync.error ?? 'unknown error'}`;
  if (lastSync.status === 'running') return 'Sync in progress…';

  const when = new Date(lastSync.finishedAt ?? lastSync.startedAt).toLocaleString();
  const scanned = `${pluralize(lastSync.postsScanned, 'post')}, ${pluralize(lastSync.pagesScanned, 'page')}`;
  return `Synced ${when} · ${scanned}`;
}

/** "Unused" reads better than "0 uses" on a card. */
export function describeUsage(referenceCount: number): string {
  return referenceCount === 0 ? 'Unused' : pluralize(referenceCount, 'use');
}
