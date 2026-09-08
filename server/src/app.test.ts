import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase, type Database } from './db/index.js';
import { SessionStore, SESSION_COOKIE_NAME } from './sessions.js';
import type { GhostAdminClient } from './ghost/client.js';
import { canonicalize } from './ghost/urls.js';
import { upsertImage } from './catalog/repo.js';

const SITE = 'https://blog.example.com';

describe('HTTP API', () => {
  let db: Database;
  let server: Server;
  let baseUrl: string;
  let sessions: SessionStore;
  let sessionCookie: string;
  let imageId: number;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const config = loadConfig({ DATABASE_PATH: ':memory:' } as NodeJS.ProcessEnv);
    sessions = new SessionStore(config.sessionTtlMs);

    // A signed-in session without a live Ghost site: only the routes that call
    // out to Ghost need the real client, and those are not exercised here.
    const session = sessions.create(
      SITE,
      'staff@example.com',
      {} as GhostAdminClient,
      'Administrator',
    );
    sessionCookie = `${SESSION_COOKIE_NAME}=${session.id}`;

    imageId = upsertImage(
      db,
      SITE,
      canonicalize(`${SITE}/content/images/2024/01/hero.jpg`, SITE)!,
      new Date().toISOString(),
    );

    server = createApp(db, config, sessions).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    sessions.stop();
    db.close();
  });

  it('refuses catalog reads without a session', async () => {
    const response = await fetch(`${baseUrl}/api/images`);
    expect(response.status).toBe(401);
  });

  it('lists catalog images for a signed-in user', async () => {
    const response = await fetch(`${baseUrl}/api/images`, {
      headers: { Cookie: sessionCookie },
    });
    const body = (await response.json()) as { total: number; images: Array<{ fileName: string }> };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.images[0]!.fileName).toBe('hero.jpg');
  });

  it('saves and returns custom metadata', async () => {
    const response = await fetch(`${baseUrl}/api/images/${imageId}/metadata`, {
      method: 'PUT',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: 'Founders at the launch', tags: ['team', 'launch'] }),
    });
    const body = (await response.json()) as { metadata: { caption: string; tags: string[] } };

    expect(response.status).toBe(200);
    expect(body.metadata.caption).toBe('Founders at the launch');
    expect(body.metadata.tags).toEqual(['team', 'launch']);
  });

  it('rejects metadata that fails validation', async () => {
    const response = await fetch(`${baseUrl}/api/images/${imageId}/metadata`, {
      method: 'PUT',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: 'not-an-array' }),
    });
    expect(response.status).toBe(400);
  });

  it('404s on an image from another site', async () => {
    const response = await fetch(`${baseUrl}/api/images/9999`, {
      headers: { Cookie: sessionCookie },
    });
    expect(response.status).toBe(404);
  });

  it('reports login state to an anonymous visitor', async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    expect(await response.json()).toEqual({ signedIn: false, lockedSiteUrl: null });
  });

  it('answers a malformed JSON body with 400, not 500', async () => {
    const response = await fetch(`${baseUrl}/api/images/${imageId}/metadata`, {
      method: 'PUT',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a sync from a role that only sees its own posts', async () => {
    const limited = sessions.create(SITE, 'author@example.com', {} as GhostAdminClient, 'Author');
    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${limited.id}` },
    });
    expect(response.status).toBe(403);
  });

  it('does not trust proxy forwarding headers unless configured to', () => {
    const app = createApp(db, loadConfig({} as NodeJS.ProcessEnv), new SessionStore(1000));
    expect(app.get('trust proxy')).toBeFalsy();
  });

  it('honours TRUST_PROXY so req.secure can follow X-Forwarded-Proto', () => {
    const app = createApp(
      db,
      loadConfig({ TRUST_PROXY: 'true' } as NodeJS.ProcessEnv),
      new SessionStore(1000),
    );
    expect(app.get('trust proxy')).toBe(true);
  });

  describe('sign-in with a staff token', () => {
    const GOOD_ID = 'a'.repeat(24);
    const GOOD_TOKEN = `${GOOD_ID}:${'b'.repeat(64)}`;
    let server2: Server;
    let url2: string;

    // Ghost that only recognises a JWT signed with key id GOOD_ID.
    const tokenAwareGhost = (): typeof fetch =>
      (async (input: string | URL, init?: RequestInit) => {
        const { pathname } = new URL(String(input));
        const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? '';
        if (pathname === '/ghost/api/admin/site/') {
          return new Response(
            JSON.stringify({ site: { title: 'Blog', url: SITE, version: '5.0' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (pathname === '/ghost/api/admin/users/me/') {
          const header = auth.startsWith('Ghost ') ? auth.slice(6).split('.')[0] : '';
          const kid = header
            ? (JSON.parse(Buffer.from(header, 'base64url').toString()) as { kid?: string }).kid
            : undefined;
          if (kid !== GOOD_ID) {
            return new Response(
              JSON.stringify({ errors: [{ message: 'Unknown Admin API Key' }] }),
              {
                status: 401,
              },
            );
          }
          return new Response(
            JSON.stringify({ users: [{ email: 'staff@example.com', roles: [{ name: 'Owner' }] }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`tokenAwareGhost: unexpected ${pathname}`);
      }) as unknown as typeof fetch;

    beforeEach(async () => {
      const config = loadConfig({ DATABASE_PATH: ':memory:' } as NodeJS.ProcessEnv);
      server2 = createApp(db, config, new SessionStore(config.sessionTtlMs), {
        loginFetch: tokenAwareGhost(),
      }).listen(0);
      await new Promise((resolve) => server2.once('listening', resolve));
      url2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      await new Promise((resolve) => server2.close(resolve));
    });

    it('signs in when the staff token is one Ghost accepts', async () => {
      const response = await fetch(`${url2}/api/auth/staff-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: SITE, token: GOOD_TOKEN }),
      });
      const body = (await response.json()) as { signedIn?: boolean; email?: string; role?: string };

      expect(response.status).toBe(200);
      expect(body.signedIn).toBe(true);
      expect(body.email).toBe('staff@example.com');
      expect(body.role).toBe('Owner');
      expect(response.headers.get('set-cookie') ?? '').toContain(SESSION_COOKIE_NAME);
    });

    it('rejects a token Ghost does not recognise', async () => {
      const response = await fetch(`${url2}/api/auth/staff-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: SITE, token: `${'c'.repeat(24)}:${'d'.repeat(64)}` }),
      });
      expect(response.status).toBe(401);
    });

    it('rejects a malformed token without calling Ghost', async () => {
      const response = await fetch(`${url2}/api/auth/staff-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: SITE, token: 'not-a-real-token' }),
      });
      expect(response.status).toBe(400);
    });
  });
});
