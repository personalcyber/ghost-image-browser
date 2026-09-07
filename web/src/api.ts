import type {
  AuthState,
  Filters,
  ImageDetail,
  ImageMetadata,
  ImageSummary,
  LastSync,
  SyncResult,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    // The session cookie is httpOnly and set by our own server, so every call
    // has to opt in to sending it.
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : {},
    ...init,
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  me: () => request<AuthState>('/auth/me'),

  login: (siteUrl: string, email: string, password: string) =>
    request<AuthState>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ siteUrl, email, password }),
    }),

  logout: () => request<AuthState>('/auth/logout', { method: 'POST' }),

  lastSync: () => request<{ lastSync: LastSync | null }>('/sync'),

  sync: () => request<{ result: SyncResult }>('/sync', { method: 'POST' }),

  images: (filters: Filters) => {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.usage) params.set('usage', filters.usage);
    if (filters.unusedOnly) params.set('unused', 'true');
    if (filters.internalOnly) params.set('internal', 'true');
    params.set('limit', '200');
    return request<{ total: number; images: ImageSummary[] }>(`/images?${params}`);
  },

  image: (id: number) => request<{ image: ImageDetail }>(`/images/${id}`),

  saveMetadata: (id: number, patch: Partial<Omit<ImageMetadata, 'updatedAt'>>) =>
    request<{ metadata: ImageMetadata }>(`/images/${id}/metadata`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
