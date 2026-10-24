export interface TelegramWebApp { initData:string; initDataUnsafe?:{user?:{id:number;first_name?:string}}; themeParams?:Record<string,string>; ready:()=>void; expand:()=>void; close:()=>void; MainButton?:{setText:(text:string)=>void;show:()=>void;hide:()=>void}; }
declare global { interface Window { Telegram?:{WebApp:TelegramWebApp}; } }
export function initTelegram():void{
	const webApp=window.Telegram?.WebApp;
	webApp?.ready();
	webApp?.expand();
	const theme=webApp?.themeParams;
	if(!theme)return;
	const root=document.documentElement;
	const colors:{source:string;target:string}[]=[
		{source:'bg_color',target:'--fh-bg'},
		{source:'secondary_bg_color',target:'--fh-surface'},
		{source:'text_color',target:'--fh-text'},
		{source:'hint_color',target:'--fh-muted'},
		{source:'button_color',target:'--fh-accent'},
		{source:'button_text_color',target:'--fh-accent-text'},
	];
	colors.forEach(({source,target})=>{const value=theme[source];if(value)root.style.setProperty(target,value);});
}
