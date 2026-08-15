import { supabase } from '@/integrations/supabase/client';
import { API_URL } from './apiUrl';



// ---------------------------------------------------------------------------
// Plan limit event bus
// ---------------------------------------------------------------------------

const planLimitListeners: Array<(detail: any) => void> = [];

export function onPlanLimitExceeded(cb: (detail: any) => void): () => void {
  planLimitListeners.push(cb);
  return () => {
    const i = planLimitListeners.indexOf(cb);
    if (i >= 0) planLimitListeners.splice(i, 1);
  };
}

function notifyPlanLimit(detail: any): void {
  planLimitListeners.forEach((cb) => cb(detail));
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

async function getAuthHeaders(includeContentType: boolean): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const headers = await getAuthHeaders(hasBody);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> || {}) },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    if (response.status === 402 && error.resource) {
      notifyPlanLimit(error);
    }
    throw Object.assign(new Error(error.error || error.message || `HTTP ${response.status}`), {
      status: response.status,
      body: error,
    });
  }

  return response.json();
}

export const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: any) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = any>(path: string, body?: any) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
  postMultipart: async <T = any>(path: string, formData: FormData): Promise<T> => {
    const headers = await getAuthHeaders(false);
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw Object.assign(new Error(error.error || error.message || `HTTP ${response.status}`), {
        status: response.status,
        body: error,
      });
    }
    return response.json();
  },
};
