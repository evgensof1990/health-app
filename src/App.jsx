import { useCallback, useEffect, useState } from 'react';
import { api, getCfg } from './api.js';
import { FoodScreen } from './food.jsx';
import { ProfileForm } from './profile.jsx';
import { Settings } from './settings.jsx';
import { Soon } from './soon.jsx';
import { Icon } from './icons.jsx';

const TABS = [
  { id: 'food', label: 'Питание', icon: 'food' },
  { id: 'growth', label: 'Развитие', icon: 'book' },
  { id: 'self', label: 'Я', icon: 'spark' },
  { id: 'style', label: 'Стиль', icon: 'shirt' },
];

const CACHE = 'health-cache';
const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE)) || null;
  } catch (e) {
    return null;
  }
};
const writeCache = (d) => {
  try {
    localStorage.setItem(CACHE, JSON.stringify(d));
  } catch (e) {
    /* quota */
  }
};

export default function App() {
  const [tab, setTab] = useState(() => localStorage.getItem('health-tab') || 'food');
  const [data, setDataRaw] = useState(readCache);
  const [cfg, setCfgState] = useState(getCfg);
  const [screen, setScreen] = useState(null); // 'settings' | 'profile'
  const [error, setError] = useState(null);

  const setData = useCallback((fn) => {
    setDataRaw((d) => {
      const n = typeof fn === 'function' ? fn(d) : fn;
      writeCache(n);
      return n;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!getCfg()?.key) return;
    try {
      setData(await api('GET', '/api/state'));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [setData]);

  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh, cfg]);

  useEffect(() => {
    try {
      localStorage.setItem('health-tab', tab);
    } catch (e) {
      /* ignore */
    }
  }, [tab]);

  if (!cfg?.key || screen === 'settings') {
    return (
      <Settings
        cfg={cfg}
        onClose={cfg?.key ? () => setScreen(null) : null}
        onSave={(c) => {
          setCfgState(c);
          setScreen(null);
        }}
        onProfile={() => setScreen('profile')}
      />
    );
  }

  if (data && (!data.profile || screen === 'profile')) {
    return (
      <ProfileForm
        profile={data.profile}
        onClose={data.profile ? () => setScreen(null) : null}
        onSaved={(profile) => {
          setData((d) => ({ ...d, profile }));
          setScreen(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="app">
      <main className="main">
        {!data && <div className="center muted">{error || 'Загружаю…'}</div>}
        {data && tab === 'food' && <FoodScreen data={data} setData={setData} refresh={refresh} offlineError={error} onSettings={() => setScreen('settings')} onProfile={() => setScreen('profile')} />}
        {data && tab !== 'food' && <Soon tab={tab} />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
