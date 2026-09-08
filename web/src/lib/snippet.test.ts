import { describe, expect, it } from 'vitest';
import { buildSnippet, sizedUrl } from './snippet';
import type { ImageSummary } from '../types';

function image(overrides: Partial<ImageSummary> = {}): ImageSummary {
  return {
    id: 1,
    url: 'https://blog.example.com/content/images/2024/01/hero.jpg',
    path: '/content/images/2024/01/hero.jpg',
    fileName: 'hero.jpg',
    extension: 'jpg',
    isInternal: true,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    referenceCount: 0,
    metadata: {
      altText: '',
      caption: '',
      credit: '',
      license: '',
      notes: '',
      tags: [],
      updatedAt: null,
    },
    ...overrides,
  };
}

describe('sizedUrl', () => {
  it('asks Ghost for a responsive variant', () => {
    expect(sizedUrl(image(), 400)).toBe(
      'https://blog.example.com/content/images/size/w400/2024/01/hero.jpg',
    );
  });

  it('leaves third-party images alone', () => {
    const external = image({ url: 'https://images.unsplash.com/photo-1', isInternal: false });
    expect(sizedUrl(external, 400)).toBe('https://images.unsplash.com/photo-1');
  });
});

describe('buildSnippet', () => {
  const described = image({
    metadata: { ...image().metadata, altText: 'Founders on stage', caption: 'Launch day, 2024' },
  });

  it('returns the bare URL', () => {
    expect(buildSnippet(described, 'url')).toBe(described.url);
  });

  it('carries catalog alt text and caption into the HTML snippet', () => {
    expect(buildSnippet(described, 'html')).toBe(
      '<figure>\n' +
        '  <img src="https://blog.example.com/content/images/2024/01/hero.jpg" alt="Founders on stage">\n' +
        '  <figcaption>Launch day, 2024</figcaption>\n' +
        '</figure>',
    );
  });

  it('omits the figure wrapper when there is no caption', () => {
    const alt = image({ metadata: { ...image().metadata, altText: 'Plain' } });
    expect(buildSnippet(alt, 'html')).toBe(
      '<img src="https://blog.example.com/content/images/2024/01/hero.jpg" alt="Plain">',
    );
  });

  it('escapes quotes so the snippet cannot break out of the attribute', () => {
    const risky = image({
      metadata: { ...image().metadata, altText: 'A "quoted" <tag>' },
    });
    expect(buildSnippet(risky, 'html')).toContain('alt="A &quot;quoted&quot; &lt;tag&gt;"');
  });

  it('escapes brackets in markdown alt text', () => {
    const bracketed = image({ metadata: { ...image().metadata, altText: 'a [b] c' } });
    expect(buildSnippet(bracketed, 'markdown')).toBe(
      '![a \\[b\\] c](https://blog.example.com/content/images/2024/01/hero.jpg)',
    );
  });
});
