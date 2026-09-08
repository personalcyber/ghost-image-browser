import { canonicalize, type CanonicalImage } from './urls.js';

/** Where in a post or page an image was found. */
export type ImageUsage = 'feature_image' | 'content' | 'og_image' | 'twitter_image';

export interface GhostResource {
  id: string;
  uuid?: string | null;
  title?: string | null;
  slug?: string | null;
  status?: string | null;
  url?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  feature_image?: string | null;
  og_image?: string | null;
  twitter_image?: string | null;
  html?: string | null;
  lexical?: string | null;
  mobiledoc?: string | null;
}

export interface ExtractedImage {
  image: CanonicalImage;
  usage: ImageUsage;
}

/**
 * Attribute-level scan of rendered post HTML.
 *
 * Ghost's rendered output is well-formed and we only need `src`/`srcset` off
 * `<img>` and `<source>`, so a tag scan avoids pulling a DOM parser into the
 * server. Anything malformed enough to defeat this is also not rendering an
 * image in a browser.
 */
const IMG_OR_SOURCE_TAG = /<(?:img|source)\b[^>]*>/gi;
const ATTRIBUTE = /\b(src|srcset|data-src|data-srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * `<video>`/`<audio>` blocks, removed before the tag scan. A video card's
 * nested `<source>` points at an mp4, and the HTML path assumes everything it
 * finds is an image — so those `<source>` elements have to go before they reach
 * the catalogue. A `<source>` left over after this is inside a `<picture>` and
 * genuinely is an image.
 */
const MEDIA_BLOCK = /<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** `type="video/mp4"` on a bare `<source>` — anything not `image/*` is skipped. */
const TYPE_ATTRIBUTE = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** Pulls the URLs out of one `srcset` value, dropping the width/density descriptors. */
export function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

/** Collects every image URL referenced by `<img>`/`<source>` tags in rendered HTML. */
export function extractHtmlImageUrls(html: string): string[] {
  const urls: string[] = [];
  for (const tag of html.replace(MEDIA_BLOCK, ' ').match(IMG_OR_SOURCE_TAG) ?? []) {
    if (/^<source\b/i.test(tag)) {
      const type = TYPE_ATTRIBUTE.exec(tag);
      const value = type?.[2] ?? type?.[3] ?? type?.[4];
      if (value && !/^image\//i.test(value)) continue;
    }
    ATTRIBUTE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTRIBUTE.exec(tag)) !== null) {
      const name = attr[1]!.toLowerCase();
      const value = attr[3] ?? attr[4] ?? attr[5] ?? '';
      if (!value) continue;
      if (name === 'srcset' || name === 'data-srcset') urls.push(...parseSrcset(value));
      else urls.push(value);
    }
  }
  return urls;
}

/**
 * Keys that hold an image URL in Ghost's editor payloads. Cards nest freely
 * (galleries, headers, signup cards), so the payload is walked rather than
 * matched card by card — new card types with a `*Src` key are picked up for
 * free.
 */
function isImageKey(key: string): boolean {
  return key === 'src' || /Src$/.test(key);
}

/** Recursively collects image URLs from a parsed lexical or mobiledoc payload. */
export function extractPayloadImageUrls(node: unknown, key = ''): string[] {
  if (typeof node === 'string') return isImageKey(key) ? [node] : [];
  if (Array.isArray(node)) return node.flatMap((child) => extractPayloadImageUrls(child, key));
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([childKey, value]) =>
      extractPayloadImageUrls(value, childKey),
    );
  }
  return [];
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Ghost has shipped several editor formats; an unparsable payload should
    // cost us that one resource's card images, not the whole sync.
    return null;
  }
}

/**
 * Extracts every distinct image referenced by one post or page.
 *
 * Deduplicated per (image, usage): a hero image that also appears in three
 * responsive `srcset` entries is one `content` reference, not four.
 *
 * @param aliases Other hostnames for the same site — see `canonicalize`.
 */
export function extractImages(
  resource: GhostResource,
  siteUrl: string,
  aliases: string[] = [],
): ExtractedImage[] {
  const found = new Map<string, ExtractedImage>();

  const add = (raw: string | null | undefined, usage: ImageUsage, assumeImage: boolean) => {
    if (!raw) return;
    const image = canonicalize(raw, siteUrl, assumeImage, aliases);
    if (!image) return;
    const key = `${usage}::${image.path}`;
    if (!found.has(key)) found.set(key, { image, usage });
  };

  add(resource.feature_image, 'feature_image', true);
  add(resource.og_image, 'og_image', true);
  add(resource.twitter_image, 'twitter_image', true);

  // <img>/<source> tags are proof of an image; bare `*Src` values in editor
  // payloads are not (a video card's `src` is an mp4), so they must look like one.
  for (const url of extractHtmlImageUrls(resource.html ?? '')) add(url, 'content', true);
  for (const payload of [parseJson(resource.lexical), parseJson(resource.mobiledoc)]) {
    for (const url of extractPayloadImageUrls(payload)) add(url, 'content', false);
  }

  return [...found.values()];
}
