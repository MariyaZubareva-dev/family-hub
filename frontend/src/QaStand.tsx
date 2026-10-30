import type { ReactNode } from 'react';

const users = [
  ['999001', 'Анна — администратор'],
  ['999002', 'Борис — участник'],
];
const current = localStorage.getItem('dev_telegram_id');
if (!users.some(([id]) => id === current)) localStorage.setItem('dev_telegram_id', '999001');

export default function QaStand({ children }: { children: ReactNode }) {
  return <>
    <aside style={{ padding: '10px 16px', background: '#fff2c6', color: '#362e18', fontSize: 14 }}>
      <strong>Тестовый стенд · вымышленные данные</strong>{' '}
      <label>Пользователь: <select aria-label="Тестовый пользователь" value={localStorage.getItem('dev_telegram_id') || '999001'} onChange={event => {
        localStorage.setItem('dev_telegram_id', event.target.value);
        window.location.reload();
      }}>{users.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <div>Переключение перезагрузит страницу. Несохранённый ввод пропадёт. Telegram-уведомления отключены.</div>
    </aside>
    {children}
  </>;
}
