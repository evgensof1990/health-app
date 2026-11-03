// Server connection: address + access key live in localStorage on this device.
const CFG_KEY = 'health-cfg';
export const DEFAULT_URL = 'https://health.myrenthub.ru';

export const getCfg = () => {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) || null;
  } catch (e) {
    return null;
  }
};
export const setCfg = (cfg) => {
  try {
    if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CFG_KEY);
  } catch (e) {
    /* storage unavailable */
  }
};

export async function api(method, path, body, { raw = false, cfg = getCfg() } = {}) {
  if (!cfg?.url || !cfg?.key) throw new Error('Сервер не подключён: открой настройки');
  let r;
  try {
    r = await fetch(cfg.url.replace(/\/$/, '') + path, {
      method,
      headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
      body: body == null ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch (e) {
    throw Object.assign(new Error('Нет связи с сервером'), { offline: true });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Ошибка сервера ' + r.status), { status: r.status });
  return j;
}

// Shrinks a photo to ≤1280 px JPEG so it uploads fast on mobile data
export function shrinkImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.82);
      resolve({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: c.toDataURL('image/jpeg', 0.5) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть фото'));
    };
    img.src = url;
  });
}

export const aiTask = async (name, input, photoId) => (await api('POST', '/api/ai/' + name, { input, photoId })).result;

export async function uploadPhoto(base64) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return (await api('POST', '/api/photos', bin, { raw: true })).id;
}

// <img> cannot send the access key, so photos are fetched as blobs and cached per session
const photoCache = new Map();
export function photoUrl(id) {
  if (!photoCache.has(id)) {
    const cfg = getCfg();
    photoCache.set(
      id,
      fetch(cfg.url.replace(/\/$/, '') + '/api/photos/' + id, { headers: { Authorization: 'Bearer ' + cfg.key } })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('Фото не загрузилось'))))
        .then((b) => URL.createObjectURL(b))
        .catch((e) => {
          photoCache.delete(id);
          throw e;
        })
    );
  }
  return photoCache.get(id);
}
