/**
 * Ghost serves the same underlying file under many URLs: responsive size
 * variants (`/content/images/size/w600/...`), on-the-fly format conversion
 * (`/content/images/size/w600/format/webp/...`), the `__GHOST_URL__` placeholder
 * that the Admin API leaves in lexical/mobiledoc payloads, and plain relative
 * paths in hand-written HTML. The catalog is only useful if all of those
 * collapse to one entry, so every discovered URL goes through canonicalize()
 * before it reaches the database.
 */

/** File extensions we accept when a URL's context does not already imply an image. */
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'heic',
]);

/** Ghost's placeholder for the site root inside lexical and mobiledoc payloads. */
const GHOST_URL_PLACEHOLDER = '__GHOST_URL__';

/** `/size/w600/` and `/size/w600h400/` — the responsive variant segment. */
const SIZE_SEGMENT = /\/size\/[whWH]\d+(?:[whWH]\d+)*\//;

/** `/format/webp/` — the on-the-fly format conversion segment. */
const FORMAT_SEGMENT = /\/format\/[a-z0-9]+\//i;

export interface CanonicalImage {
  /** Absolute, de-duplicated URL, safe to render in an <img>. */
  url: string;
  /**
   * Stable catalog key. For images hosted by the site this is the origin-less
   * path so the catalog survives a domain change; for third-party images it is
   * the absolute URL.
   */
  path: string;
  fileName: string;
  extension: string;
  /** True when the file is served by the Ghost site itself. */
  internal: boolean;
}

/** Normalizes a site URL to an origin + base path with no trailing slash. */
export function normalizeSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

function extensionOf(pathname: string): string {
  const fileName = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Resolves and de-duplicates a single image URL.
 *
 * @param raw       URL as it appeared in the Ghost payload.
 * @param siteUrl   The Ghost site URL the user signed in through. Relative and
 *   placeholder URLs resolve against it, and internal images are rewritten onto
 *   it so the browser always loads them from a host it can actually reach.
 * @param assumeImage
 *   Set when the surrounding context already proves this is an image (an `<img>`
 *   tag, `feature_image`, a gallery card). Extension-less CDN URLs — Unsplash
 *   being the common case on Ghost sites — are only kept when this is true.
 * @param aliases
 *   Other URLs that are the same site. Ghost stores `feature_image` and card
 *   images as absolute URLs built from its *configured* `url`, which routinely
 *   differs from the host an admin signs in through (apex vs www, a separate
 *   admin domain, a tunnel in development). Without the alias those URLs look
 *   third-party and the same upload is catalogued twice.
 * @returns The canonical form, or null when the URL is unusable or not an image.
 */
export function canonicalize(
  raw: string,
  siteUrl: string,
  assumeImage = false,
  aliases: string[] = [],
): CanonicalImage | null {
  const candidate = raw?.trim();
  if (!candidate) return null;

  // Data URIs are inline bytes, not catalogable site assets.
  if (/^data:/i.test(candidate)) return null;

  const base = normalizeSiteUrl(siteUrl);
  const resolvedInput = candidate.startsWith(GHOST_URL_PLACEHOLDER)
    ? base + candidate.slice(GHOST_URL_PLACEHOLDER.length)
    : candidate;

  let parsed: URL;
  try {
    parsed = new URL(resolvedInput, `${base}/`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // Sizing and format live in the URL, not in the file: drop them so every
  // variant of one upload lands on a single catalog row.
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(SIZE_SEGMENT, '/').replace(FORMAT_SEGMENT, '/');

  const internal = [base, ...aliases.map(normalizeSiteUrl)].some((candidate) => {
    const candidateUrl = new URL(`${candidate}/`);
    return (
      parsed.host === candidateUrl.host &&
      parsed.pathname.startsWith(candidateUrl.pathname.replace(/\/$/, ''))
    );
  });

  const isGhostUpload = internal && parsed.pathname.includes('/content/images/');
  const extension = extensionOf(parsed.pathname);

  if (!isGhostUpload && !assumeImage && !IMAGE_EXTENSIONS.has(extension)) return null;

  const fileName = decodeURIComponent(parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1));

  return {
    // An internal image is keyed and served by path off the signed-in host, so
    // the catalog survives the site moving domains and never renders an <img>
    // pointing at a host the user cannot reach.
    url: internal ? `${new URL(base).origin}${parsed.pathname}` : parsed.toString(),
    path: internal ? parsed.pathname : parsed.toString(),
    fileName,
    extension,
    internal,
  };
}
