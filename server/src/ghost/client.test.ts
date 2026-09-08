import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GhostAdminClient, GhostApiError } from './client.js';

const SITE = 'https://blog.example.com';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A `fetch` stand-in that routes by "METHOD path" and records every call, so a
 * test can both hand back a canned Ghost response and assert on what the client
 * sent (auth header, verb, query).
 */
function fakeGhost(routes: Record<string, () => Response>): {
  impl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method, headers, body });

    const key = `${method} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`fakeGhost: no route for ${key}`);
    return route();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('GhostAdminClient.fromStaffToken', () => {
  const ID = 'a'.repeat(24);
  const SECRET = 'b'.repeat(64);
  const meRoute = {
    'GET /ghost/api/admin/users/me/': () =>
      new Response(JSON.stringify({ users: [{ email: 'a@b.com', roles: [{ name: 'Owner' }] }] }), {
        status: 200,
      }),
  };

  it('signs each request with a Ghost JWT bearer token, no cookie', async () => {
    const { impl, calls } = fakeGhost(meRoute);

    const client = GhostAdminClient.fromStaffToken(SITE, `  ${ID}:${SECRET}  `, impl);
    await client.getCurrentUser();

    const auth = calls[0]!.headers.authorization ?? '';
    expect(auth.startsWith('Ghost ')).toBe(true);
    expect(calls[0]!.headers.cookie).toBeUndefined();

    const [header, payload, signature] = auth.slice('Ghost '.length).split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({
      alg: 'HS256',
      kid: ID,
    });
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({
      aud: '/admin/',
    });
    const expected = createHmac('sha256', Buffer.from(SECRET, 'hex'))
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(signature).toBe(expected);
  });

  it('rejects a token that is not an id:secret hex pair', () => {
    expect(() => GhostAdminClient.fromStaffToken(SITE, 'nope')).toThrow(GhostApiError);
  });

  it('surfaces a Ghost rejection of the token', async () => {
    const { impl } = fakeGhost({
      'GET /ghost/api/admin/users/me/': () =>
        new Response(JSON.stringify({ errors: [{ message: 'Unknown Admin API Key' }] }), {
          status: 401,
        }),
    });
    const client = GhostAdminClient.fromStaffToken(SITE, `${ID}:${SECRET}`, impl);

    await expect(client.getCurrentUser()).rejects.toBeInstanceOf(GhostApiError);
  });
});
