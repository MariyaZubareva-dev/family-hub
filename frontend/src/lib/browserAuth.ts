// Session cookie stays HttpOnly. The CSRF secret is held only in memory.
let csrfToken: string | null = null;
export const setBrowserCsrf = (token: string | null) => { csrfToken = token; };
export const isTelegram = () => Boolean((window as any).Telegram?.WebApp?.initData);

export function familyHeaders(method = 'GET'): Record<string,string> {
  const headers: Record<string,string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const initData = (window as any).Telegram?.WebApp?.initData;
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  } else if (import.meta.env.DEV) {
    const devId = localStorage.getItem('dev_telegram_id');
    if (devId) headers['X-Dev-Telegram-User-Id'] = devId;
  }
  if (!['GET','HEAD','OPTIONS'].includes(method.toUpperCase()) && csrfToken && !initData) {
    headers['X-Family-CSRF'] = csrfToken;
  }
  return headers;
}

export async function authRequest(path: string, body: unknown): Promise<any> {
  const response = await fetch('/api/v1/auth/' + path, {
    method: 'POST', credentials: 'same-origin',
    headers: familyHeaders('POST'), body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const details = Object.values(result?.errors || {}).flat().join(' ');
    throw new Error(details || result?.message || 'Не удалось выполнить действие.');
  }
  return result;
}
