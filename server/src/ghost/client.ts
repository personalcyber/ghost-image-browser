import { createHmac } from 'node:crypto';
import type { GhostResource } from './extract.js';
import { normalizeSiteUrl } from './urls.js';

const ADMIN_API_VERSION = 'v5.0';
const PAGE_SIZE = 100;
/** Ghost staff/admin API keys are `<24 hex>:<64 hex>`. */
const STAFF_TOKEN = /^([0-9a-f]{24}):([0-9a-f]{64})$/i;

export type GhostResourceType = 'posts' | 'pages';

/**
 * The subset of `fetch` this client uses. Injectable so sign-in can be tested
 * without a live Ghost site; production passes the global `fetch`.
 */
export type FetchImpl = typeof fetch;

const b64url = (value: string): string => Buffer.from(value).toString('base64url');

/**
 * Mints the short-lived HS256 JWT Ghost's Admin API expects for key auth
 * (`Authorization: Ghost <jwt>`), matching `@tryghost/admin-api`: `kid` header,
 * 5-minute expiry, `/admin/` audience. Done here with `node:crypto` to avoid a
 * jsonwebtoken dependency.
 */
function signAdminToken(id: string, secretHex: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }));
  const body = `${header}.${payload}`;
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

export class GhostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GhostApiError';
  }
}

interface GhostErrorBody {
  errors?: Array<{ message?: string; context?: string; type?: string; code?: string }>;
}

async function readError(response: Response, fallback: string): Promise<GhostApiError> {
  let body: GhostErrorBody = {};
  try {
    body = (await response.json()) as GhostErrorBody;
  } catch {
    // Ghost returns HTML for some proxy-level failures; the status still tells us enough.
  }
  const error = body.errors?.[0];
  const detail = [error?.message, error?.context].filter(Boolean).join(' — ');
  return new GhostApiError(detail || fallback, response.status, error?.code ?? error?.type);
}

/**
 * Talks to a Ghost site's Admin API *as a staff member* — never as an
 * integration — using that user's **Staff Access Token** (`id:secret`, from
 * their Ghost profile page). Every request carries a freshly-signed
 * `Authorization: Ghost <jwt>`; the token is held server-side (see
 * `sessions.ts`) and never reaches the browser.
 */
export class GhostAdminClient {
  readonly siteUrl: string;
  private aliases: string[] = [];

  private constructor(
    siteUrl: string,
    private readonly staffToken: { id: string; secret: string },
    private readonly fetchImpl: FetchImpl,
  ) {
    this.siteUrl = normalizeSiteUrl(siteUrl);
  }

  /**
   * Other URLs that mean this same site, learned from `getSite()`.
   *
   * Ghost builds the absolute image URLs it stores from its own configured
   * `url`, so unless the admin happens to sign in through exactly that host,
   * those URLs must be recognised as internal via this list.
   */
  get siteAliases(): string[] {
    return this.aliases;
  }

  /**
   * Builds a client from a Ghost Staff Access Token. Bound to that user's role,
   * so it keeps the "you only see your own" guarantee. The token's validity is
   * only proven by the first API call the caller makes.
   *
   * @throws GhostApiError when the token is not a well-formed `id:secret` pair.
   */
  static fromStaffToken(
    siteUrl: string,
    token: string,
    fetchImpl: FetchImpl = fetch,
  ): GhostAdminClient {
    const match = STAFF_TOKEN.exec(token.trim());
    if (!match) {
      throw new GhostApiError(
        'That does not look like a Ghost staff token. Copy the "Staff Access Token" from ' +
          'your Ghost profile page — it is a long id:secret pair.',
        400,
      );
    }
    return new GhostAdminClient(
      normalizeSiteUrl(siteUrl),
      { id: match[1]!, secret: match[2]! },
      fetchImpl,
    );
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.siteUrl}/ghost/api/admin/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Version': ADMIN_API_VERSION,
        Authorization: `Ghost ${signAdminToken(this.staffToken.id, this.staffToken.secret)}`,
      },
      redirect: 'manual',
    });

    if (!response.ok) throw await readError(response, `Ghost request failed: GET ${path}`);
    return (await response.json()) as T;
  }

  /**
   * The signed-in user's primary role name (`Owner`, `Administrator`, `Editor`,
   * `Author`, `Contributor`). Used to decide whether this session may run a
   * full-site sync — see `catalog/roles.ts`.
   */
  async getCurrentUser(): Promise<{ email: string; role: string }> {
    const body = await this.get<{
      users?: Array<{ email?: string; roles?: Array<{ name?: string }> }>;
    }>('users/me/', { include: 'roles' });
    const user = body.users?.[0];
    return { email: user?.email ?? '', role: user?.roles?.[0]?.name ?? 'Unknown' };
  }

  /** Confirms the token is valid and returns the site's own metadata. */
  async getSite(): Promise<{ title: string; url: string; version: string }> {
    const body = await this.get<{ site: { title: string; url: string; version: string } }>('site/');
    if (body.site?.url) {
      try {
        const configured = normalizeSiteUrl(body.site.url);
        if (configured !== this.siteUrl) this.aliases = [configured];
      } catch {
        // A malformed `url` in Ghost's config costs us alias matching, nothing more.
      }
    }
    return body.site;
  }

  /**
   * Walks every post or page, one API page at a time.
   *
   * Ghost caps `limit` well below most sites' post counts and `limit=all` on a
   * large site with full HTML bodies is a memory problem on both ends, so this
   * yields batches for the caller to process incrementally.
   */
  async *browse(type: GhostResourceType): AsyncGenerator<GhostResource[]> {
    let page = 1;
    for (;;) {
      const body = await this.get<{
        [key: string]: GhostResource[] | { pagination?: { pages: number | null } } | undefined;
      }>(`${type}/`, {
        formats: 'html,lexical,mobiledoc',
        limit: String(PAGE_SIZE),
        page: String(page),
      });

      const items = (body[type] as GhostResource[] | undefined) ?? [];
      if (items.length > 0) yield items;

      const meta = body.meta as { pagination?: { pages: number | null } } | undefined;
      const totalPages = meta?.pagination?.pages ?? 1;
      if (page >= (totalPages || 1) || items.length === 0) return;
      page += 1;
    }
  }
}
