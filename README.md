# Ghost Image Browser

A browser-based catalog of every image on a Ghost CMS site.

Sign in with your Ghost **staff email and password**, scan the site, and get one
row per image showing which posts and pages use it, how, and any details you
want to record that Ghost itself has nowhere to store.

## What it does

- **Catalogs every image** referenced by posts and pages — feature images,
  images in the body, gallery and header cards, and Open Graph / Twitter images.
- **Shows the references**: which post or page uses each image, in what role,
  and whether that post is published or still a draft.
- **Finds unused images**: anything the catalog has seen that nothing currently
  references.
- **Stores extra details** Ghost does not keep — alt text, caption, credit,
  licence, tags, free-form notes — keyed to the image so they survive re-syncs.
- **Makes images reusable**: copy the URL, an HTML `<figure>`, or Markdown, with
  your catalog alt text and caption already filled in.

## Requirements

- Node.js 22.5 or newer (the catalog uses the built-in `node:sqlite` module).
- A Ghost site and a staff account on it. Accounts with two-factor
  authentication enabled cannot be used — Ghost requires a one-time code that
  this sign-in flow has no way to supply.

## Getting started

```bash
npm install
cp .env.example .env      # optional: pin GHOST_URL to one site
npm run dev               # API on :4000, UI on :5173
```

Open http://localhost:5173, sign in, and press **Sync from Ghost**.

For a single-process deployment:

```bash
npm run build
npm start                 # serves the built UI and the API on one origin
```

## How your credentials are handled

Your email and password are posted to your own Ghost site's session endpoint and
are never written to disk. The Ghost session cookie that comes back is held in
the server's memory; your browser only ever receives an opaque session id. Signing
out or restarting the server discards it.

## Configuration

See `.env.example`. `GHOST_URL` pins the app to a single Ghost site and removes
the site field from the login form; leave it unset to let users name the site.

## Development

```bash
npm test          # unit and API tests
npm run lint
npm run typecheck
```
