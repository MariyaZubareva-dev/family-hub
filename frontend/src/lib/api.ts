const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'; 
const DEV_TELEGRAM_USER_ID = import.meta.env.VITE_DEV_TELEGRAM_USER_ID;

export async function apiFetch<T>(path:string, options:RequestInit = {}):Promise<T>{
  const headers = new Headers(options.headers);
  headers.set('Accept','application/json');
  if(options.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  const initData = window.Telegram?.WebApp?.initData;
  if(initData) headers.set('X-Telegram-Init-Data',initData);
  else if(import.meta.env.DEV && DEV_TELEGRAM_USER_ID) headers.set('X-Dev-Telegram-User-Id',String(DEV_TELEGRAM_USER_ID));
  const res = await fetch(`${API_BASE_URL}${path}`,{...options,headers});
  if(!res.ok){ let message=`API error: ${res.status}`; try{const body=await res.json(); if(body?.message)message=body.message; if(body?.errors)message=Object.values(body.errors as Record<string,string[]>).flat().join(' ');}catch{} throw new Error(message); }
  if(res.status===204) return undefined as T;
  return res.json();
}
export const get = <T,>(path:string)=>apiFetch<T>(path);
export const post = <T,>(path:string,body:unknown)=>apiFetch<T>(path,{method:'POST',body:JSON.stringify(body)});
export const patch = <T,>(path:string,body:unknown)=>apiFetch<T>(path,{method:'PATCH',body:JSON.stringify(body)});
export const del = <T=void,>(path:string)=>apiFetch<T>(path,{method:'DELETE'});
