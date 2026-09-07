import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { ImageDetail } from './components/ImageDetail';
import { ImageGrid } from './components/ImageGrid';
import { LoginForm } from './components/LoginForm';
import { Toolbar } from './components/Toolbar';
import type { AuthState, Filters, ImageMetadata, ImageSummary, LastSync } from './types';

const EMPTY_FILTERS: Filters = { query: '', usage: '', unusedOnly: false, internalOnly: false };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setAuth)
      .catch(() => setAuth({ signedIn: false }));
  }, []);

  const refresh = useCallback(async () => {
    try {
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

  async function handleLogin(siteUrl: string, email: string, password: string) {
    setAuth(await api.login(siteUrl, email, password));
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
    return <LoginForm lockedSiteUrl={auth.lockedSiteUrl ?? null} onSubmit={handleLogin} />;
  }

  return (
    <div className="layout">
      <Toolbar
        filters={filters}
        onChange={setFilters}
        onSync={() => void handleSync()}
        syncing={syncing}
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
        <ImageGrid
          images={images}
          selectedId={selectedId}
          onSelect={(image) => setSelectedId(image.id)}
        />
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
