export interface TelegramWebApp { initData:string; initDataUnsafe?:{user?:{id:number;first_name?:string}}; ready:()=>void; expand:()=>void; close:()=>void; MainButton?:{setText:(text:string)=>void;show:()=>void;hide:()=>void}; }
declare global { interface Window { Telegram?:{WebApp:TelegramWebApp}; } }
export function initTelegram():void{window.Telegram?.WebApp?.ready();window.Telegram?.WebApp?.expand();}
