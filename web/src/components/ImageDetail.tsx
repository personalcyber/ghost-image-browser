import { useEffect, useState } from 'react';
import { api } from '../api';
import { pluralize } from '../lib/format';
import { buildSnippet, sizedUrl, type SnippetFormat } from '../lib/snippet';
import type { ImageDetail as ImageDetailType, ImageMetadata } from '../types';

interface Props {
  imageId: number;
  onClose: () => void;
  /** Lets the grid show updated captions and notes without a refetch. */
  onMetadataSaved: (imageId: number, metadata: ImageMetadata) => void;
}

const USAGE_LABELS: Record<string, string> = {
  feature_image: 'Feature image',
  content: 'In content',
  og_image: 'Open Graph image',
  twitter_image: 'Twitter image',
};

const SNIPPET_FORMATS: Array<{ format: SnippetFormat; label: string }> = [
  { format: 'url', label: 'Copy URL' },
  { format: 'html', label: 'Copy HTML' },
  { format: 'markdown', label: 'Copy Markdown' },
];

export function ImageDetail({ imageId, onClose, onMetadataSaved }: Props) {
  const [image, setImage] = useState<ImageDetailType | null>(null);
  const [draft, setDraft] = useState<ImageMetadata | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setDraft(null);
    setStatus(null);
    setError(null);

    api
      .image(imageId)
      .then(({ image: loaded }) => {
        if (cancelled) return;
        setImage(loaded);
        setDraft(loaded.metadata);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load image.');
      });

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  async function copy(format: SnippetFormat) {
    if (!image) return;
    const snippet = buildSnippet({ ...image, metadata: draft ?? image.metadata }, format);
    try {
      await navigator.clipboard.writeText(snippet);
      setStatus(`${format.toUpperCase()} copied to clipboard`);
    } catch {
      // Clipboard access needs a secure context; the snippet is still selectable
      // in the textarea below, so this is a soft failure.
      setStatus('Clipboard unavailable — copy the snippet manually.');
    }
  }

  async function save() {
    if (!image || !draft) return;
    setError(null);
    try {
      const { metadata } = await api.saveMetadata(image.id, {
        altText: draft.altText,
        caption: draft.caption,
        credit: draft.credit,
        license: draft.license,
        notes: draft.notes,
        tags: draft.tags,
      });
      setDraft(metadata);
      setImage({ ...image, metadata });
      onMetadataSaved(image.id, metadata);
      setStatus('Saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    }
  }

  function update<K extends keyof ImageMetadata>(key: K, value: ImageMetadata[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setStatus(null);
  }

  return (
    <aside className="detail" aria-label="Image details">
      <header className="detail__header">
        <h2>{image?.fileName ?? 'Loading…'}</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {image && draft && (
        <>
          <img className="detail__preview" src={sizedUrl(image, 800)} alt={draft.altText} />

          <div className="detail__actions">
            {SNIPPET_FORMATS.map(({ format, label }) => (
              <button key={format} type="button" onClick={() => void copy(format)}>
                {label}
              </button>
            ))}
            <a href={image.url} target="_blank" rel="noreferrer">
              Open original
            </a>
          </div>
          {status && <p className="status">{status}</p>}

          <section>
            <h3>Used by {pluralize(image.references.length, 'post or page', 'posts and pages')}</h3>
            {image.references.length === 0 ? (
              <p className="muted">
                Nothing on the site references this image. It is safe to reuse — or to retire.
              </p>
            ) : (
              <ul className="references">
                {image.references.map((reference) => (
                  <li key={`${reference.resourceId}-${reference.usage}`}>
                    {reference.resourceUrl ? (
                      <a href={reference.resourceUrl} target="_blank" rel="noreferrer">
                        {reference.resourceTitle ?? reference.resourceSlug ?? reference.resourceId}
                      </a>
                    ) : (
                      (reference.resourceTitle ?? reference.resourceId)
                    )}
                    <span className="tag">{reference.resourceType}</span>
                    <span className="tag">{USAGE_LABELS[reference.usage] ?? reference.usage}</span>
                    {reference.resourceStatus !== 'published' && (
                      <span className="tag tag--warn">{reference.resourceStatus}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Catalog details</h3>
            <p className="muted">
              Held here, not in Ghost. Alt text and caption are reused by the copy buttons above.
            </p>

            <label>
              Alt text
              <input value={draft.altText} onChange={(e) => update('altText', e.target.value)} />
            </label>
            <label>
              Caption
              <input value={draft.caption} onChange={(e) => update('caption', e.target.value)} />
            </label>
            <label>
              Credit
              <input value={draft.credit} onChange={(e) => update('credit', e.target.value)} />
            </label>
            <label>
              Licence
              <input value={draft.license} onChange={(e) => update('license', e.target.value)} />
            </label>
            <label>
              Tags (comma separated)
              <input
                value={draft.tags.join(', ')}
                onChange={(e) =>
                  update(
                    'tags',
                    e.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              Notes
              <textarea
                rows={4}
                value={draft.notes}
                onChange={(e) => update('notes', e.target.value)}
              />
            </label>

            <button type="button" className="primary" onClick={() => void save()}>
              Save details
            </button>
          </section>
        </>
      )}
    </aside>
  );
}
