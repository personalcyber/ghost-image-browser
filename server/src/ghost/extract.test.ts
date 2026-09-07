import { describe, expect, it } from 'vitest';
import { extractHtmlImageUrls, extractImages, parseSrcset } from './extract.js';

const SITE = 'https://blog.example.com';

describe('parseSrcset', () => {
  it('keeps the URLs and drops the descriptors', () => {
    expect(parseSrcset('/a.jpg 600w, /b.jpg 1000w')).toEqual(['/a.jpg', '/b.jpg']);
  });
});

describe('extractHtmlImageUrls', () => {
  it('reads src and srcset off img and source tags', () => {
    const html = `
      <figure class="kg-card">
        <picture>
          <source srcset="/content/images/size/w600/2024/01/a.webp 600w" type="image/webp">
          <img src="/content/images/2024/01/a.jpg" alt="A" loading="lazy">
        </picture>
      </figure>`;
    expect(extractHtmlImageUrls(html)).toEqual([
      '/content/images/size/w600/2024/01/a.webp',
      '/content/images/2024/01/a.jpg',
    ]);
  });

  it('handles single-quoted and unquoted attributes', () => {
    expect(extractHtmlImageUrls(`<img src='/a.jpg'><img src=/b.jpg>`)).toEqual([
      '/a.jpg',
      '/b.jpg',
    ]);
  });
});

describe('extractImages', () => {
  it('records each usage of an image on a post', () => {
    const found = extractImages(
      {
        id: 'p1',
        feature_image: `${SITE}/content/images/2024/01/hero.jpg`,
        og_image: `${SITE}/content/images/2024/01/hero.jpg`,
        html: `<img src="/content/images/2024/01/body.png">`,
      },
      SITE,
    );

    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usage: 'feature_image' }),
        expect.objectContaining({ usage: 'og_image' }),
        expect.objectContaining({ usage: 'content' }),
      ]),
    );
    expect(found).toHaveLength(3);
  });

  it('counts responsive variants of one file as a single content reference', () => {
    const found = extractImages(
      {
        id: 'p1',
        html: `<img src="/content/images/2024/01/a.jpg"
                    srcset="/content/images/size/w600/2024/01/a.jpg 600w,
                            /content/images/size/w1000/2024/01/a.jpg 1000w">`,
      },
      SITE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.image.path).toBe('/content/images/2024/01/a.jpg');
  });

  it('walks lexical cards, including nested gallery images', () => {
    const lexical = JSON.stringify({
      root: {
        children: [
          { type: 'image', src: '__GHOST_URL__/content/images/2024/01/card.jpg' },
          {
            type: 'gallery',
            images: [
              { src: '__GHOST_URL__/content/images/2024/01/g1.jpg' },
              { src: '__GHOST_URL__/content/images/2024/01/g2.jpg' },
            ],
          },
          { type: 'header', backgroundImageSrc: '__GHOST_URL__/content/images/2024/01/bg.jpg' },
        ],
      },
    });

    const paths = extractImages({ id: 'p1', lexical }, SITE).map((found) => found.image.path);
    expect(paths).toEqual([
      '/content/images/2024/01/card.jpg',
      '/content/images/2024/01/g1.jpg',
      '/content/images/2024/01/g2.jpg',
      '/content/images/2024/01/bg.jpg',
    ]);
  });

  it('ignores non-image src values such as a video card upload', () => {
    const lexical = JSON.stringify({
      root: { children: [{ type: 'video', src: '__GHOST_URL__/content/media/2024/01/clip.mp4' }] },
    });
    expect(extractImages({ id: 'p1', lexical }, SITE)).toEqual([]);
  });

  it('still reads mobiledoc posts written in the old editor', () => {
    const mobiledoc = JSON.stringify({
      cards: [['image', { src: '__GHOST_URL__/content/images/2018/05/legacy.jpg' }]],
    });
    expect(extractImages({ id: 'p1', mobiledoc }, SITE)[0]?.image.path).toBe(
      '/content/images/2018/05/legacy.jpg',
    );
  });

  it('survives an unparsable editor payload', () => {
    expect(
      extractImages({ id: 'p1', lexical: '{not json', html: '<img src="/a.jpg">' }, SITE),
    ).toHaveLength(1);
  });
});
