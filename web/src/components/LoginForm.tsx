import { useState, type FormEvent } from 'react';

interface Props {
  /** Set when the deployment is pinned to one site via GHOST_URL. */
  lockedSiteUrl: string | null;
  /** Prefill for the site field, remembered from the last successful sign-in. */
  initialSiteUrl: string;
  onSubmit: (siteUrl: string, token: string) => Promise<void>;
}

export function LoginForm({ lockedSiteUrl, initialSiteUrl, onSubmit }: Props) {
  const [siteUrl, setSiteUrl] = useState(lockedSiteUrl ?? initialSiteUrl);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(siteUrl, token.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That staff token was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <h1>Ghost Image Browser</h1>
        <p className="login__lede">
          Sign in with your Ghost <strong>Staff Access Token</strong> — copy it from your profile
          page in Ghost admin. It works as you, with your role, and never leaves this server.
        </p>

        {!lockedSiteUrl && (
          <label>
            Ghost site URL
            <input
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              required
              autoComplete="url"
            />
          </label>
        )}

        <label>
          Staff Access Token
          <textarea
            rows={3}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="653f…:9a1c…"
            required
            autoFocus
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || token.trim() === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
