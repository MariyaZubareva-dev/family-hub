import { familyHeaders } from './browserAuth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET';
  const headers = new Headers(familyHeaders(method));
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options, credentials: 'same-origin', headers,
  });
  if (!response.ok) {
    let message = `API error: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
      if (body?.errors) message = Object.values(body.errors as Record<string,string[]>).flat().join(' ');
    } catch { /* API may return no JSON body. */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const get = <T,>(path: string) => apiFetch<T>(path);
export const post = <T,>(path: string, body: unknown) => apiFetch<T>(path,{method:'POST',body:JSON.stringify(body)});
export const patch = <T,>(path: string, body: unknown) => apiFetch<T>(path,{method:'PATCH',body:JSON.stringify(body)});
export const del = <T=void,>(path: string) => apiFetch<T>(path,{method:'DELETE'});
