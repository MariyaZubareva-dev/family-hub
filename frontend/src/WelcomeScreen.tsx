import { useEffect, useRef, useState } from 'react'
import './welcome.css'

export type FirstAction = 'shopping' | 'calendar' | 'finance' | 'home'
type Invitation = { id: string; family?: { name?: string }; inviter?: { first_name?: string; username?: string } }
type Props = {
  apiGet: (path: string) => Promise<any>
  apiPost: (path: string, body: unknown) => Promise<any>
  onComplete: (action: FirstAction, created: boolean) => Promise<void>
}
export function WelcomeIcon({ kind }: { kind: FirstAction }) {
  const paths = {
    shopping: 'M4 7h16l-2 14H6L4 7Zm4 0V5a4 4 0 0 1 8 0v2',
    calendar: 'M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16 M8 15h2 M14 15h2',
    finance: 'M3 6h18v15H3z M3 10h18 M15 15h3 M7 3h10',
    home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>
}
const choices: { id: FirstAction; title: string; text: string }[] = [
  { id: 'shopping', title: 'Составить список покупок', text: 'Запишите, что нужно купить к следующему походу в магазин.' },
  { id: 'calendar', title: 'Добавить событие', text: 'Сохраните ближайшую встречу или семейный план.' },
  { id: 'finance', title: 'Записать расход', text: 'Начните с одной покупки, чтобы видеть, куда уходят деньги.' },
]
export default function WelcomeScreen({ apiGet, apiPost, onComplete }: Props) {
  const [step, setStep] = useState<'welcome' | 'choose' | 'create' | 'invite'>('welcome')
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState<FirstAction>('shopping')
  const [name, setName] = useState('Моя семья')
  const pending = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const loadInvitations = async (signal?: AbortSignal) => {
    setLoading(true); setError('')
    try {
      const result = await apiGet('/family/invitations')
      if (signal?.aborted) return
      const incoming = result.data || []
      setInvitations(incoming)
      if (incoming.length) setStep('invite')
    } catch { if (!signal?.aborted) setError('Не удалось проверить приглашения. Проверьте соединение и попробуйте ещё раз.') }
    finally { if (!signal?.aborted) setLoading(false) }
  }
  useEffect(() => { const controller = new AbortController(); void loadInvitations(controller.signal); return () => controller.abort() }, [])
  useEffect(() => { heading.current?.focus() }, [step])
  const choose = (target: FirstAction) => { setAction(target); setStep('create'); setError('') }
  const create = async () => {
    if (pending.current || !name.trim()) return
    pending.current = true; setBusy(true); setError('')
    try {
      // A previous request may have succeeded even if its response was lost.
      const me = await apiGet('/me')
      if (!me.data?.family) await apiPost('/families', { name: name.trim() })
      await onComplete(action, true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать семью. Попробуйте ещё раз.') }
    finally { pending.current = false; setBusy(false) }
  }
  const accept = async (invitation: Invitation) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const me = await apiGet('/me')
      if (!me.data?.family) await apiPost(`/family/invitations/${invitation.id}/accept`, {})
      await onComplete('home', false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось принять приглашение. Попробуйте ещё раз.') }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="welcome" aria-busy={busy}>
    <div className="welcome-eyebrow"><span className="welcome-brand-mark"><WelcomeIcon kind="home" /></span>Для вас и ваших близких</div>
    {error && <div className="family-alert" role="alert">{error}<button className="welcome-link" disabled={busy || loading} onClick={() => void loadInvitations()}>Проверить приглашения ещё раз</button></div>}
    {step === 'welcome' && <>
      <h2 ref={heading} tabIndex={-1}>Меньше забот.<br /><span>Больше вместе.</span></h2>
      <p className="welcome-lead">Покупки, планы и расходы семьи — в одном приложении внутри Telegram.</p>
      <div className="welcome-preview" aria-label="Пример возможностей Family Hub">
        <span className="welcome-example">Пример</span>
        <article className="welcome-demo welcome-shopping"><div className="welcome-card-title"><span className="welcome-icon"><WelcomeIcon kind="shopping" /></span><strong>По пути домой</strong><span className="welcome-avatar">А</span></div><div className="welcome-demo-row"><span className="welcome-check checked">✓</span><span className="welcome-crossed">Хлеб</span><small>1 шт.</small></div><div className="welcome-demo-row"><span className="welcome-check" />Молоко<small>2 л</small></div><div className="welcome-demo-row"><span className="welcome-check" />Яблоки<small>1 кг</small></div><p>Один список для всех</p></article>
        <article className="welcome-demo welcome-event"><span className="welcome-date"><b>18:30</b>завтра</span><div><strong>Семейный ужин</strong><p>Планы, о которых все знают</p></div><span className="welcome-icon"><WelcomeIcon kind="calendar" /></span></article>
        <article className="welcome-demo welcome-money"><div><span className="welcome-card-title"><span className="welcome-icon"><WelcomeIcon kind="finance" /></span><strong>Расходы под рукой</strong></span><p>Продукты · Дом · Транспорт</p></div><span className="welcome-bars" aria-hidden="true"><i /><i /><i /></span></article>
      </div>
      <div className="welcome-actions"><button className="button primary full" disabled={loading} onClick={() => setStep('choose')}>{loading ? 'Проверяем приглашения…' : 'Начать пользоваться'}</button><button className="welcome-link" onClick={() => { setStep('invite'); void loadInvitations() }}>Меня пригласили</button><p>Можно начать самостоятельно.<br />Близких пригласите, когда будете готовы.</p></div>
    </>}
    {step === 'choose' && <>
      <h2 ref={heading} tabIndex={-1}>С чего начнём?</h2><p className="welcome-lead">Выберите одну задачу. Остальное можно освоить позже.</p>
      <div className="welcome-choices">{choices.map(choice => <button key={choice.id} className="welcome-choice" onClick={() => choose(choice.id)}><span className="welcome-icon"><WelcomeIcon kind={choice.id} /></span><span><strong>{choice.title}</strong><small>{choice.text}</small></span><span aria-hidden="true">→</span></button>)}</div>
      <button className="welcome-link" onClick={() => choose('home')}>Пока посмотреть приложение</button><button className="welcome-link" onClick={() => setStep('welcome')}>Назад</button>
    </>}
    {step === 'create' && <>
      <h2 ref={heading} tabIndex={-1}>Как назовём вашу семью?</h2><p className="welcome-lead">Оставьте «Моя семья» или придумайте своё название. Его можно изменить позже.</p>
      <form className="welcome-create" onSubmit={e => { e.preventDefault(); void create() }}><label>Название семьи<input value={name} maxLength={120} required disabled={busy} onChange={e => setName(e.target.value)} autoComplete="off" /></label><p>Сейчас участником будете только вы. Приглашать близких необязательно.</p><button className="button primary full" disabled={busy || !name.trim()}>{busy ? 'Открываем…' : 'Создать семью и продолжить'}</button></form>
      <button className="welcome-link" disabled={busy} onClick={() => setStep('choose')}>Назад</button>
    </>}
    {step === 'invite' && <>
      <h2 ref={heading} tabIndex={-1}>{invitations.length ? 'Вас ждут в семье' : 'Присоединиться к близким'}</h2>
      {loading ? <p role="status">Проверяем приглашения…</p> : invitations.length ? <><p className="welcome-lead">Общие покупки и планы будут под рукой у каждого.</p>{invitations.map(inv => <article className="welcome-invitation" key={inv.id}><span className="welcome-icon"><WelcomeIcon kind="home" /></span><h3>{inv.family?.name || 'Семья'}</h3><p>Приглашает {inv.inviter?.first_name || inv.inviter?.username || 'администратор семьи'}.</p><p>Участники с доступом к разделу видят его общие записи, в том числе расходы. Доступ настраивает администратор.</p><button className="button primary full" disabled={busy} onClick={() => void accept(inv)}>{busy ? 'Присоединяемся…' : 'Принять приглашение'}</button></article>)}</> : <div className="welcome-invitation"><p>Пока нет активных приглашений для вашего Telegram-аккаунта.</p><p>Попросите близкого пригласить вас в разделе «Семья» по вашему Telegram ID или логину, затем проверьте ещё раз.</p><button className="button secondary full" disabled={busy} onClick={() => void loadInvitations()}>Проверить приглашения</button></div>}
      <button className="welcome-link" disabled={busy || loading} onClick={() => setStep('choose')}>Создать свою семью</button><button className="welcome-link" disabled={busy} onClick={() => setStep('welcome')}>Назад</button>
    </>}
  </section>
}
