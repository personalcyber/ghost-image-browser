import type { ImageSummary } from '../types';

/**
 * Rewrites a Ghost image URL to a responsive variant.
 *
 * Ghost generates size variants on demand under `/content/images/size/wNNN/`,
 * so the grid can ask for thumbnails instead of pulling full-resolution
 * originals. Third-party images have no such endpoint and are returned as-is.
 */
export function sizedUrl(image: Pick<ImageSummary, 'url' | 'isInternal'>, width: number): string {
  const marker = '/content/images/';
  const index = image.url.indexOf(marker);
  if (!image.isInternal || index === -1) return image.url;

  const head = image.url.slice(0, index + marker.length);
  const tail = image.url.slice(index + marker.length);
  return `${head}size/w${width}/${tail}`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type SnippetFormat = 'url' | 'html' | 'markdown';

/**
 * Builds a paste-ready snippet for reusing an image elsewhere in Ghost.
 *
 * The point of the catalog's own alt text and caption is that they travel with
 * the image: reusing it in a new post should not mean retyping them, so they
 * are baked into the snippet rather than left for the editor to fill in.
 */
export function buildSnippet(image: ImageSummary, format: SnippetFormat): string {
  const { altText, caption } = image.metadata;

  if (format === 'url') return image.url;

  if (format === 'markdown') {
    const markdown = `![${altText.replace(/([[\]])/g, '\\$1')}](${image.url})`;
    return caption ? `${markdown}\n*${caption}*` : markdown;
  }

  const img = `<img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(altText)}">`;
  if (!caption) return img;
  return `<figure>\n  ${img}\n  <figcaption>${escapeAttribute(caption)}</figcaption>\n</figure>`;
}
