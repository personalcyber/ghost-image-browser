import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { ImageDetail } from './components/ImageDetail';
import { ImageGrid } from './components/ImageGrid';
import { LoginForm } from './components/LoginForm';
import { Toolbar } from './components/Toolbar';
import type { AuthState, Filters, ImageMetadata, ImageSummary, LastSync } from './types';

/** Remembers the last Ghost site signed into, so the field is prefilled next time. */
const SITE_URL_KEY = 'gib.siteUrl';
export function rememberSiteUrl(siteUrl: string): void {
  try {
    localStorage.setItem(SITE_URL_KEY, siteUrl);
  } catch {
    // Private mode / storage disabled — prefill just won't persist.
  }
}
export function recallSiteUrl(): string {
  try {
    return localStorage.getItem(SITE_URL_KEY) ?? '';
  } catch {
    return '';
  }
}

const EMPTY_FILTERS: Filters = { query: '', usage: '', unusedOnly: false, internalOnly: false };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setAuth)
      .catch(() => setAuth({ signedIn: false }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      // Always the first page: changing a filter resets the list.
      const { images: loaded, total: count } = await api.images(filters);
      setImages(loaded);
      setTotal(count);
      setError(null);
    } catch (cause) {
      // A 401 means the Ghost session expired underneath us; drop back to login
      // rather than showing a stale catalog the user can no longer act on.
      if (cause instanceof ApiError && cause.status === 401) setAuth({ signedIn: false });
      else setError(cause instanceof Error ? cause.message : 'Could not load the catalog.');
    }
  }, [filters]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const { images: page, total: count } = await api.images(filters, { offset: images.length });
      setImages((current) => [...current, ...page]);
      setTotal(count);
      setError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setAuth({ signedIn: false });
      else setError(cause instanceof Error ? cause.message : 'Could not load more images.');
    } finally {
      setLoadingMore(false);
    }
  }, [filters, images.length]);

  useEffect(() => {
    if (!auth?.signedIn) return;
    // Debounced so typing in the search box does not fire a query per keystroke.
    const timer = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(timer);
  }, [auth?.signedIn, refresh]);

  useEffect(() => {
    if (!auth?.signedIn) return;
    api
      .lastSync()
      .then(({ lastSync: last }) => setLastSync(last))
      .catch(() => setLastSync(null));
  }, [auth?.signedIn]);

  async function handleStaffTokenLogin(siteUrl: string, token: string) {
    const next = await api.staffTokenLogin(siteUrl, token);
    if (next.signedIn) rememberSiteUrl(next.siteUrl ?? siteUrl);
    setAuth(next);
  }

  async function handleSignOut() {
    await api.logout().catch(() => undefined);
    setAuth({ signedIn: false });
    setImages([]);
    setSelectedId(null);
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await api.sync();
      const { lastSync: last } = await api.lastSync();
      setLastSync(last);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setAuth({ signedIn: false });
      else setError(cause instanceof Error ? cause.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  function handleMetadataSaved(imageId: number, metadata: ImageMetadata) {
    setImages((current) =>
      current.map((image) => (image.id === imageId ? { ...image, metadata } : image)),
    );
  }

  if (!auth) return <main className="loading">Loading…</main>;

  if (!auth.signedIn) {
    return (
      <LoginForm
        lockedSiteUrl={auth.lockedSiteUrl ?? null}
        initialSiteUrl={recallSiteUrl()}
        onSubmit={handleStaffTokenLogin}
      />
    );
  }

  return (
    <div className="layout">
      <Toolbar
        filters={filters}
        onChange={setFilters}
        onSync={() => void handleSync()}
        syncing={syncing}
        canSync={auth.canSync ?? true}
        lastSync={lastSync}
        total={total}
        shown={images.length}
        siteUrl={auth.siteUrl ?? ''}
        email={auth.email ?? ''}
        onSignOut={() => void handleSignOut()}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="layout__body">
        <div className="layout__catalog">
          <ImageGrid
            images={images}
            selectedId={selectedId}
            onSelect={(image) => setSelectedId(image.id)}
          />
          {images.length < total && (
            <button
              type="button"
              className="ghost load-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : `Load more (${total - images.length} left)`}
            </button>
          )}
        </div>
        {selectedId !== null && (
          <ImageDetail
            imageId={selectedId}
            onClose={() => setSelectedId(null)}
            onMetadataSaved={handleMetadataSaved}
          />
        )}
      </div>
    </div>
  );
}
