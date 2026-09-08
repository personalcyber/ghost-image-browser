/**
 * Mirrors the JSON the server returns. The two workspaces intentionally do not
 * share a types package — the API is the contract, and these declarations are
 * what the UI expects to receive. Keep them in step with `server/src/catalog/repo.ts`.
 */

export type ImageUsage = 'feature_image' | 'content' | 'og_image' | 'twitter_image';

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

export interface SyncResult {
  postsScanned: number;
  pagesScanned: number;
  imagesFound: number;
  referencesFound: number;
  staleReferencesRemoved: number;
  finishedAt: string;
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

export interface AuthState {
  signedIn: boolean;
  siteUrl?: string;
  email?: string;
  role?: string;
  /** Whether this Ghost role is allowed to run a sync — see server roles.ts. */
  canSync?: boolean;
  lockedSiteUrl?: string | null;
}

export interface Filters {
  query: string;
  usage: ImageUsage | '';
  unusedOnly: boolean;
  internalOnly: boolean;
}
