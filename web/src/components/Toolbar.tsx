import { useEffect, useRef } from 'react';
import { describeSync } from '../lib/format';
import type { Filters, ImageUsage, LastSync } from '../types';

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onSync: () => void;
  syncing: boolean;
  lastSync: LastSync | null;
  total: number;
  shown: number;
  siteUrl: string;
  email: string;
  onSignOut: () => void;
}

const USAGE_OPTIONS: Array<{ value: ImageUsage | ''; label: string }> = [
  { value: '', label: 'Any usage' },
  { value: 'feature_image', label: 'Feature images' },
  { value: 'content', label: 'In content' },
  { value: 'og_image', label: 'Open Graph' },
  { value: 'twitter_image', label: 'Twitter' },
];

/**
 * Publishes the toolbar's real height as `--toolbar-height`.
 *
 * The toolbar is sticky and its height changes with viewport width (the filter
 * row wraps), so the detail panel's own sticky offset has to follow it rather
 * than hard-code a guess.
 */
function useMeasuredHeight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const publish = () =>
      document.documentElement.style.setProperty('--toolbar-height', `${element.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}

export function Toolbar({
  filters,
  onChange,
  onSync,
  syncing,
  lastSync,
  total,
  shown,
  siteUrl,
  email,
  onSignOut,
}: Props) {
  const toolbarRef = useRef<HTMLElement>(null);
  useMeasuredHeight(toolbarRef);

  return (
    <header className="toolbar" ref={toolbarRef}>
      <div className="toolbar__row">
        <div>
          <h1>Ghost Image Browser</h1>
          <p className="muted">
            {siteUrl} · {email}
          </p>
        </div>
        <div className="toolbar__actions">
          <button type="button" className="primary" onClick={onSync} disabled={syncing}>
            {syncing ? 'Scanning site…' : 'Sync from Ghost'}
          </button>
          <button type="button" className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="toolbar__row toolbar__filters">
        <input
          type="search"
          placeholder="Search file names, paths and notes"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
        />
        <select
          value={filters.usage}
          onChange={(event) =>
            onChange({ ...filters, usage: event.target.value as ImageUsage | '' })
          }
        >
          {USAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.unusedOnly}
            onChange={(event) => onChange({ ...filters, unusedOnly: event.target.checked })}
          />
          Unused only
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.internalOnly}
            onChange={(event) => onChange({ ...filters, internalOnly: event.target.checked })}
          />
          Hide external
        </label>
      </div>

      <p className="muted toolbar__status">
        Showing {shown} of {total} catalogued images · {describeSync(lastSync)}
      </p>
    </header>
  );
}
