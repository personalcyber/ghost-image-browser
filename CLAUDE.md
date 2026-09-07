# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser UI that catalogs every image on a Ghost CMS site: which posts and
pages reference each image, plus extra details (alt text, caption, credit,
licence, tags, notes) that Ghost has nowhere to store. Users sign in with their
Ghost **staff email and password** — not an integration API key.

## Commands

```bash
npm install                       # workspaces: server + web
npm run dev                       # API on :4000 and Vite UI on :5173 together
npm run dev:server                # API alone (node --watch)
npm run build                     # tsc for both, then vite build
npm start                         # single process: API + built UI on one origin

npm test                          # all tests (vitest, one runner for both workspaces)
npm run typecheck                 # tsc -b server web
npm run lint                      # eslint flat config
npm run format                    # prettier --write
```

Running one test or one file:

```bash
npx vitest run server/src/ghost/urls.test.ts
npx vitest run -t 'collapses responsive size variants'
npx vitest                        # watch mode
```

CI (`.github/workflows/ci.yml`) runs format:check, lint, typecheck, test, build —
run those locally before pushing.

## Architecture

Two npm workspaces. There is deliberately no shared types package: the HTTP API
is the contract, and `web/src/types.ts` mirrors what the server returns. **If you
change a response shape in `server/src/catalog/repo.ts`, update
`web/src/types.ts` to match** — nothing enforces this automatically.

Request flow for the one thing this app does:

```
LoginForm → POST /api/auth/login → GhostAdminClient.login()
                                     → POST {site}/ghost/api/admin/session/
                                     → Ghost session cookie kept in SessionStore
Toolbar "Sync" → POST /api/sync → syncCatalog()
                                     → client.browse('posts'|'pages')  (paginated)
                                     → extractImages() per resource
                                     → canonicalize() each URL
                                     → upsertImage + upsertReference (stamped with run id)
                                     → pruneStaleReferences()
ImageGrid/ImageDetail → GET /api/images, PUT /api/images/:id/metadata
```

Key modules:

- `server/src/ghost/urls.ts` — URL canonicalization. The heart of the catalog.
- `server/src/ghost/extract.ts` — pulls image URLs out of a post or page.
- `server/src/ghost/client.ts` — Ghost Admin API over a staff session cookie.
- `server/src/catalog/sync.ts` — orchestrates a scan; owns the pruning rule.
- `server/src/catalog/repo.ts` — all SQL. Nothing else in the app writes SQL.
- `web/src/lib/snippet.ts` — reuse snippets and Ghost responsive-thumbnail URLs.

## Invariants worth knowing before changing things

**Ghost serves one upload under many URLs.** Size variants
(`/content/images/size/w600/…`), format conversion (`/format/webp/`), the
`__GHOST_URL__` placeholder in lexical/mobiledoc, relative paths, and query
strings all point at the same file. `canonicalize()` collapses them, and the
catalog is only correct because everything goes through it. Add a new
discovery source? Route it through `canonicalize()`.

**The site has more than one name.** Ghost stores absolute image URLs built from
its own configured `url`, which routinely differs from the host an admin signs in
through (apex vs www, a separate admin domain, a dev tunnel). `getSite()` learns
that configured URL and exposes it as `siteAliases`, which `canonicalize()` treats
as internal. Dropping this silently doubles every feature image in the catalog.

**References are pruned by sync run id, not by timestamp.** Two syncs can start
in the same millisecond; an ISO timestamp cannot tell them apart and the prune
becomes a no-op. `sync_runs.id` is the key — keep it that way.

**Images are never deleted; references are.** User metadata hangs off the image
row, so an image that drops out of every post keeps its row (and its notes) and
surfaces under the "unused" filter. Deleting image rows would silently destroy
user-authored data.

**`image_metadata` is the only table that is not a cache.** `images` and
`image_references` are rebuilt from Ghost on every sync. Metadata is keyed on
`(site_url, canonical path)` so it survives re-syncs, post deletions and
re-uploads to the same path.

**Ghost credentials never reach the browser.** `SessionStore` (in-memory) holds
the Ghost session cookie; the browser gets an opaque random id in an httpOnly
cookie. Sessions therefore do not survive a server restart — that is intended,
not a bug to fix by persisting them.

**`assumeImage` is load-bearing in extraction.** A lexical card's `src` may be an
mp4; an `<img>` tag's `src` is definitionally an image. Extension-less CDN URLs
(Unsplash) are only catalogued when the context proves they are images. Passing
`true` indiscriminately would fill the catalog with video and audio uploads.

## Conventions and gotchas

- **`node:sqlite`**, not a native driver, so the project installs without a
  compile step. It prints `ExperimentalWarning: SQLite is an experimental
feature` on every run — expected, not a problem to chase.
- **Schema lives in `server/src/db/schema.ts`** as a TS string, not a `.sql`
  file, so `tsc` output is self-contained with no asset-copy step. There is no
  migration system: the schema is `CREATE TABLE IF NOT EXISTS` only, so a change
  to an existing table needs an explicit migration or a deleted dev database.
- **Express 5.** The SPA fallback in `server/src/index.ts` is written as
  middleware rather than `app.get('*')` because Express 5's router rejects a bare
  `'*'` pattern.
- **Tests use `openDatabase(':memory:')`** and a `CatalogSource` stub — no test
  touches a real Ghost site or the filesystem. Keep it that way; `CatalogSource`
  exists precisely so `syncCatalog` is testable.
- Ghost accounts with 2FA cannot sign in (Ghost demands a one-time code this flow
  cannot supply). `GhostAdminClient.login` detects this and returns a specific
  message — preserve it, it is the difference between "wrong password" and
  "impossible".
