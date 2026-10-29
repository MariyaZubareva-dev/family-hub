export async function calendarRequest(path:string,body?:unknown,method?:string){
  const headers:Record<string,string>={Accept:'application/json','Content-Type':'application/json'}
  const initData=(window as any).Telegram?.WebApp?.initData
  if(initData)headers['X-Telegram-Init-Data']=initData
  else headers['X-Dev-Telegram-User-Id']=localStorage.getItem('dev_telegram_id')||'999001'
  let response:Response
  try{response=await fetch('/api/v1'+path,{method:method||(body===undefined?'GET':'POST'),headers,body:body===undefined?undefined:JSON.stringify(body)})}
  catch{throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.')}
  const json=await response.json().catch(()=>null)
  if(!response.ok){
    if(response.status===401)throw new Error('Откройте приложение заново через Telegram.')
    if(response.status===403)throw new Error('Нет доступа к календарю этой семьи. Обратитесь к администратору.')
    if(response.status>=500)throw new Error('Сервер временно недоступен. Попробуйте ещё раз позже.')
    const message=Object.values(json?.errors||{}).flat()[0]||json?.message
    if(typeof message==='string'&&/[а-яё]/i.test(message)&&!/SQLSTATE|Exception|<|>/.test(message))throw new Error(message)
    throw new Error(response.status===422?'Проверьте название, дату и хотя бы одного ответственного. Данные пока не сохранены.':'Не удалось выполнить действие. Попробуйте ещё раз.')
  }
  return json
}
