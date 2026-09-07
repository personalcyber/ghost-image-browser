import { describe, expect, it } from 'vitest';
import { canonicalize, normalizeSiteUrl } from './urls.js';

const SITE = 'https://blog.example.com';

describe('normalizeSiteUrl', () => {
  it('adds a scheme and strips trailing slashes', () => {
    expect(normalizeSiteUrl('blog.example.com/')).toBe('https://blog.example.com');
  });

  it('keeps a subdirectory install path', () => {
    expect(normalizeSiteUrl('https://example.com/blog/')).toBe('https://example.com/blog');
  });
});

describe('canonicalize', () => {
  it('collapses responsive size variants onto one entry', () => {
    const original = canonicalize(`${SITE}/content/images/2024/01/hero.jpg`, SITE);
    const resized = canonicalize(`${SITE}/content/images/size/w600/2024/01/hero.jpg`, SITE);
    const both = canonicalize(`${SITE}/content/images/size/w600h400/2024/01/hero.jpg`, SITE);

    expect(original?.path).toBe('/content/images/2024/01/hero.jpg');
    expect(resized?.path).toBe(original?.path);
    expect(both?.path).toBe(original?.path);
  });

  it('strips the on-the-fly format segment', () => {
    const converted = canonicalize(
      `${SITE}/content/images/size/w1000/format/webp/2024/01/hero.jpg`,
      SITE,
    );
    expect(converted?.path).toBe('/content/images/2024/01/hero.jpg');
  });

  it('resolves the __GHOST_URL__ placeholder used in editor payloads', () => {
    const image = canonicalize('__GHOST_URL__/content/images/2024/01/card.png', SITE);
    expect(image?.url).toBe(`${SITE}/content/images/2024/01/card.png`);
    expect(image?.internal).toBe(true);
  });

  it('resolves relative paths against the site', () => {
    expect(canonicalize('/content/images/2024/01/rel.jpg', SITE)?.url).toBe(
      `${SITE}/content/images/2024/01/rel.jpg`,
    );
  });

  it('drops query strings and fragments so cache-busted URLs dedupe', () => {
    const image = canonicalize(`${SITE}/content/images/2024/01/hero.jpg?v=2#top`, SITE);
    expect(image?.url).toBe(`${SITE}/content/images/2024/01/hero.jpg`);
  });

  it("treats the site's own configured URL as internal, not third-party", () => {
    // Signed in through the apex domain while Ghost stores www URLs: without the
    // alias the same upload lands in the catalog twice.
    const signedInThrough = 'https://example.com';
    const image = canonicalize(
      'https://www.example.com/content/images/2024/01/hero.jpg',
      signedInThrough,
      true,
      ['https://www.example.com'],
    );

    expect(image?.internal).toBe(true);
    expect(image?.path).toBe('/content/images/2024/01/hero.jpg');
    // Rendered from the host the user actually reached, not the configured one.
    expect(image?.url).toBe('https://example.com/content/images/2024/01/hero.jpg');
  });

  it('still treats an unrelated host as external when aliases are given', () => {
    const image = canonicalize('https://cdn.other.com/a.jpg', SITE, true, [
      'https://www.example.com',
    ]);
    expect(image?.internal).toBe(false);
  });

  it('keeps a subdirectory install prefix in the canonical URL', () => {
    const image = canonicalize('/blog/content/images/2024/01/a.jpg', 'https://example.com/blog');
    expect(image?.path).toBe('/blog/content/images/2024/01/a.jpg');
    expect(image?.url).toBe('https://example.com/blog/content/images/2024/01/a.jpg');
  });

  it('keys third-party images on their absolute URL and marks them external', () => {
    const image = canonicalize('https://images.unsplash.com/photo-123?w=800', SITE, true);
    expect(image?.internal).toBe(false);
    expect(image?.path).toBe('https://images.unsplash.com/photo-123');
  });

  it('rejects extension-less third-party URLs unless the context proves an image', () => {
    expect(canonicalize('https://images.unsplash.com/photo-123', SITE)).toBeNull();
    expect(canonicalize('https://images.unsplash.com/photo-123', SITE, true)).not.toBeNull();
  });

  it('rejects data URIs, non-http schemes and non-images', () => {
    expect(canonicalize('data:image/png;base64,iVBORw0KGgo=', SITE, true)).toBeNull();
    expect(canonicalize('mailto:someone@example.com', SITE, true)).toBeNull();
    expect(canonicalize('https://cdn.example.com/video.mp4', SITE)).toBeNull();
  });

  it('reports the file name and extension', () => {
    const image = canonicalize(`${SITE}/content/images/2024/01/My%20Photo.JPG`, SITE);
    expect(image?.fileName).toBe('My Photo.JPG');
    expect(image?.extension).toBe('jpg');
  });
});
