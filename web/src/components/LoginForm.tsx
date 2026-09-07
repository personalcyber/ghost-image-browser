import { useState, type FormEvent } from 'react';

interface Props {
  /** Set when the deployment is pinned to one site via GHOST_URL. */
  lockedSiteUrl: string | null;
  onSubmit: (siteUrl: string, email: string, password: string) => Promise<void>;
}

export function LoginForm({ lockedSiteUrl, onSubmit }: Props) {
  const [siteUrl, setSiteUrl] = useState(lockedSiteUrl ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(siteUrl, email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <h1>Ghost Image Browser</h1>
        <p className="login__lede">
          Sign in with your Ghost staff account. Your credentials go straight to your Ghost site and
          are never stored here.
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
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="username"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
