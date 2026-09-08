import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from './sessions.js';
import type { GhostAdminClient } from './ghost/client.js';

const SITE = 'https://blog.example.com';
const client = {} as GhostAdminClient;

describe('SessionStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts an idle session even if nobody calls get() again', () => {
    vi.useFakeTimers();
    const store = new SessionStore(1000, 200);
    store.create(SITE, 'a@example.com', client);
    expect(store.size).toBe(1);

    vi.advanceTimersByTime(1500);

    expect(store.size).toBe(0);
    store.stop();
  });

  it('leaves a session that is still within its TTL alone', () => {
    vi.useFakeTimers();
    const store = new SessionStore(10_000, 200);
    store.create(SITE, 'a@example.com', client);

    vi.advanceTimersByTime(1000);

    expect(store.size).toBe(1);
    store.stop();
  });
});
