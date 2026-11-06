import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { authRequest, isTelegram, setBrowserCsrf } from './lib/browserAuth';
import './browser-auth.css';

type Mode = 'login' | 'register' | 'verify' | 'reset' | 'reset-confirm';
export default function BrowserAuth({ children }: {children: ReactNode}) {
  const [mode, setMode] = useState<Mode>('login');
  const [ready, setReady] = useState(false);
  const [logged, setLogged] = useState(isTelegram());
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (isTelegram()) { setReady(true); return; }
    let active = true;
    fetch('/api/v1/auth/session', {credentials:'same-origin', headers:{Accept:'application/json'}})
      .then(async response => {
        const data = await response.json().catch(() => null);
        if (active && response.ok && data?.authenticated && data?.csrf) {
          setBrowserCsrf(data.csrf); setLogged(true);
        }
      })
      .catch(() => {})
      .finally(() => {if (active) setReady(true)});
    return () => {active = false};
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'reset') {
        await authRequest('password/reset-request',{email:email.trim()});
        setMode('reset-confirm'); setNotice('Если адрес зарегистрирован, письмо с кодом отправлено.');
      } else if (mode === 'reset-confirm') {
        await authRequest('password/reset',{email:email.trim(),code,password});
        setPassword('');setCode('');setMode('login');setNotice('Пароль изменён. Войди с новым паролем.');
      } else if (mode === 'login') {
        const result = await authRequest('login',{email:email.trim(),password});
        setBrowserCsrf(result.data.csrf); setPassword(''); setLogged(true);
      } else if (mode === 'register') {
        await authRequest('register',{email:email.trim(),password,first_name:name.trim()});
        setPassword(''); setMode('verify'); setNotice('Письмо с кодом отправлено на указанный email.');
      } else {
        await authRequest('verify',{email:email.trim(),code});
        setCode(''); setMode('login'); setNotice('Адрес подтверждён. Войди с паролем.');
      }
    } catch (e) { setError(e instanceof Error?e.message:'Не удалось выполнить действие.'); }
    finally {setBusy(false)}
  }

  if (!ready) return <div className="browser-auth-loading" role="status">Загружаем Family Hub…</div>;
  if (logged) return <>{children}</>;
  return <main className="browser-auth-screen">
    <section className="browser-auth-card" aria-label="Вход в Family Hub">
      <img src="/icons/icon-192.png" alt="" width="76" height="76" />
      <h1>Family Hub</h1>
      <p>Покупки, бюджет и планы семьи — в одном месте.</p>
      <h2>{mode==='login'?'Войти':mode==='register'?'Создать аккаунт':mode==='verify'?'Подтвердить email':mode==='reset'?'Восстановить пароль':'Новый пароль'}</h2>
      <form onSubmit={submit}>
        {mode==='register'&&<label>Имя<input required autoComplete="given-name" value={name} onChange={e=>setName(e.target.value)}/></label>}
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        {(mode==='verify'||mode==='reset-confirm')&&<label>Код из письма<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label>}
        {(mode==='login'||mode==='register'||mode==='reset-confirm')&&<label>Пароль<input required type="password" minLength={mode==='register'||mode==='reset-confirm'?12:undefined} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
        {mode==='register'&&<small>Минимум 12 символов. Используй уникальный пароль.</small>}
        {error&&<div className="browser-auth-error" role="alert">{error}</div>}
        {notice&&<div className="browser-auth-notice" role="status">{notice}</div>}
        <button type="submit" disabled={busy}>{busy?'Подождите…':mode==='login'?'Войти':mode==='register'?'Зарегистрироваться':mode==='verify'?'Подтвердить':mode==='reset'?'Получить код':'Изменить пароль'}</button>
      </form>
      <div className="browser-auth-switch">
        {mode==='verify'&&<button disabled={busy} onClick={async()=>{try{setNotice((await authRequest('resend',{email})).message);setError('')}catch(e){setError(e instanceof Error?e.message:'Ошибка отправки')}}}>Отправить код повторно</button>}
        {mode==='login'?<><button onClick={()=>{setMode('register');setError('')}}>Создать аккаунт</button><button onClick={()=>{setMode('verify');setError('')}}>Уже есть код?</button><button onClick={()=>{setMode('reset');setError('')}}>Забыли пароль?</button></>:<button onClick={()=>{setMode('login');setError('')}}>Вернуться ко входу</button>}
      </div>
      <p className="browser-auth-help">Уже используешь Family Hub через Telegram? Сначала привяжи email в Telegram-версии, чтобы сохранить все семейные данные.</p>
    </section>
  </main>;
}

export function EmailLinkPanel() {
  const [open,setOpen] = useState(false);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [code,setCode] = useState('');
  const [step,setStep] = useState<'link'|'verify'>('link');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  if (!isTelegram()) return null;
  const submit = async (e:FormEvent) => {
    e.preventDefault();setBusy(true);setMessage('');
    try {
      if(step==='link'){
        await authRequest('link-email',{email,password});
        setPassword('');setStep('verify');setMessage('Код отправлен на email.');
      }else{
        await authRequest('verify',{email,code});
        setMessage('Email привязан. Можно входить с iPhone через Safari.');
      }
    }catch(err){setMessage(err instanceof Error?err.message:'Не удалось выполнить действие.')}
    finally{setBusy(false)}
  };
  return <div className="email-link">
    <button className="email-link-toggle" type="button" onClick={()=>setOpen(!open)}>{open?'Закрыть':'Подключить вход по email'}</button>
    {open&&<form onSubmit={submit}>
      <p>Привяжи email к текущему Telegram-аккаунту. Семья и данные сохранятся.</p>
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      {step==='link'?<label>Новый пароль<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)}/></label>:<label>Код из письма<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/></label>}
      {message&&<p role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy?'Подождите…':step==='link'?'Отправить код':'Подтвердить email'}</button>
    </form>}
  </div>;
}
