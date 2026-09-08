import { describeUsage } from '../lib/format';
import { sizedUrl } from '../lib/snippet';
import type { ImageSummary } from '../types';

interface Props {
  images: ImageSummary[];
  selectedId: number | null;
  onSelect: (image: ImageSummary) => void;
}

export function ImageGrid({ images, selectedId, onSelect }: Props) {
  if (images.length === 0) {
    return (
      <p className="empty">
        No images match these filters. Run a sync to scan the site, or widen the search.
      </p>
    );
  }

  return (
    <ul className="grid">
      {images.map((image) => (
        <li key={image.id}>
          <button
            type="button"
            className={`card${image.id === selectedId ? ' card--selected' : ''}`}
            onClick={() => onSelect(image)}
            aria-pressed={image.id === selectedId}
          >
            <span className="card__frame">
              <img src={sizedUrl(image, 400)} alt={image.metadata.altText} loading="lazy" />
            </span>
            <span className="card__name" title={image.path}>
              {image.fileName}
            </span>
            <span className="card__meta">
              {describeUsage(image.referenceCount)}
              {!image.isInternal && ' · external'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
