import { useState } from 'react';
import { api, setCfg, DEFAULT_URL } from './api.js';
import { Icon } from './icons.jsx';

export function Settings({ cfg, onSave, onClose, onProfile }) {
  const [url, setUrl] = useState(cfg?.url || DEFAULT_URL);
  const [key, setKey] = useState(cfg?.key || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    const next = { url: url.trim().replace(/\/$/, ''), key: key.trim() };
    setBusy(true);
    setMsg(null);
    try {
      const h = await api('GET', '/api/health', null, { cfg: next });
      await api('GET', '/api/state', null, { cfg: next });
      setCfg(next);
      setMsg({ ok: true, text: `Подключено. ИИ: ${h.ai ? 'да' : 'не настроен'}, голос: ${h.voice ? 'да' : 'не настроен'}` });
      setTimeout(() => onSave(next), 600);
    } catch (e) {
      setMsg({ ok: false, text: e.status === 401 ? 'Неверный ключ доступа' : e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page form">
      <div className="topbar">
        <h1 className="h1">Настройки</h1>
        {onClose && (
          <button className="iconbtn" onClick={onClose} data-back aria-label="Закрыть">
            <Icon name="x" />
          </button>
        )}
      </div>
      {!cfg?.key && <p className="muted">Подключи приложение к своему серверу. Ключ выдаёт скрипт установки (deploy/install.sh), посмотреть его можно командой на сервере: <code>sudo grep HEALTH_TOKEN /etc/health.env</code></p>}
      <label className="field">
        <span>Адрес сервера</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" />
      </label>
      <label className="field">
        <span>Ключ доступа</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" type="password" />
      </label>
      {msg && <div className={'note ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
      <button className="btn primary" disabled={busy || !url || key.length < 16} onClick={save}>
        {busy ? 'Проверяю…' : 'Проверить и сохранить'}
      </button>
      {cfg?.key && (
        <button className="btn" onClick={onProfile}>
          <Icon name="user" size={18} /> Профиль и норма калорий
        </button>
      )}
    </div>
  );
}
