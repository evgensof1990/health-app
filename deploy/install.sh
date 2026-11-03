#!/usr/bin/env bash
# Installs or updates the health assistant server on Ubuntu with nginx (next to the planner).
# Run on the server from the repository checkout:  sudo bash deploy/install.sh
# Safe to re-run: keeps /etc/health.env and the data in /var/lib/health.
set -euo pipefail

DOMAIN="${DOMAIN:-health.myrenthub.ru}"
APP_DIR=/opt/health
ENV_FILE=/etc/health.env
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }

# 1. Node.js >= 20 available system-wide
NODE_BIN="$(PATH=/usr/local/bin:/usr/bin:/bin command -v node || true)"
if [ -z "$NODE_BIN" ] || [ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Нужен Node.js 20+ в /usr/bin или /usr/local/bin. Сейчас: ${NODE_BIN:-не найден}"
  echo "Установка: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"
echo "Node.js: $NODE_BIN $("$NODE_BIN" -v)"

# 2. Code: server + shared helpers, server dependencies, and the web build
id health >/dev/null 2>&1 || useradd --system --home /var/lib/health --shell /usr/sbin/nologin health
mkdir -p "$APP_DIR" /var/lib/health
rm -rf "$APP_DIR/server" "$APP_DIR/shared"
cp -r "$SRC_DIR/server" "$APP_DIR/server"
cp -r "$SRC_DIR/shared" "$APP_DIR/shared"
rm -rf "$APP_DIR/server/node_modules"
(cd "$APP_DIR/server" && "$NPM_BIN" install --omit=dev --no-audit --no-fund --silent)
echo "Собираю веб-версию…"
(cd "$SRC_DIR" && "$NPM_BIN" ci --no-audit --no-fund --silent && "$NPM_BIN" run build --silent)
rm -rf "$APP_DIR/web" && cp -r "$SRC_DIR/dist" "$APP_DIR/web"
chown -R health:health /var/lib/health
chmod 700 /var/lib/health

# 3. Secrets: asked here, never typed into a chat
if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(openssl rand -hex 24)"
  PROXY_SECRET="$(openssl rand -hex 24)"
  echo
  read -rp "Адрес Cloudflare-воркера для Claude (например, https://claude-proxy.xxx.workers.dev): " PROXY_URL
  SPEECH=""
  if [ -f /etc/planovik.env ] && grep -q '^SPEECHKIT_API_KEY=.' /etc/planovik.env; then
    SPEECH="$(grep '^SPEECHKIT_API_KEY=' /etc/planovik.env | cut -d= -f2-)"
    echo "Ключ SpeechKit взят из настроек планнера."
  else
    read -rsp "API-ключ Yandex SpeechKit для голоса (Enter — пропустить): " SPEECH; echo
  fi
  umask 077
  cat > "$ENV_FILE" <<EOV
HEALTH_TOKEN=$TOKEN
AI_PROXY_URL=$PROXY_URL
AI_PROXY_SECRET=$PROXY_SECRET
SPEECHKIT_API_KEY=$SPEECH
PORT=3310
ALLOWED_ORIGINS=https://$DOMAIN,https://localhost,capacitor://localhost,http://localhost:5173
EOV
  chmod 600 "$ENV_FILE"
  echo
  echo "1) Секрет для воркера (переменная PROXY_SECRET в Cloudflare):"
  echo "   $PROXY_SECRET"
  echo "2) Ключ доступа для приложения (Настройки → Ключ доступа):"
  echo "   $TOKEN"
  echo "Посмотреть позже: sudo cat $ENV_FILE"
  echo
fi

# 4. Service
sed "s|/usr/bin/env node|$NODE_BIN|" "$SRC_DIR/deploy/health.service" > /etc/systemd/system/health.service
systemctl daemon-reload
systemctl enable health >/dev/null
systemctl restart health

# 5. nginx site + HTTPS
if [ ! -f /etc/nginx/sites-available/health.conf ]; then
  sed "s/health.myrenthub.ru/$DOMAIN/" "$SRC_DIR/deploy/nginx-health.conf" > /etc/nginx/sites-available/health.conf
  ln -sf /etc/nginx/sites-available/health.conf /etc/nginx/sites-enabled/health.conf
  nginx -t && systemctl reload nginx
  if command -v certbot >/dev/null; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --register-unsafely-without-email || echo "certbot не выпустил сертификат: проверьте, что A-запись $DOMAIN указывает на этот сервер, и запустите: sudo certbot --nginx -d $DOMAIN"
  else
    echo "certbot не найден: sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
  fi
else
  nginx -t && systemctl reload nginx
fi

sleep 2
systemctl --no-pager --lines=5 status health || true
curl -fsS "http://127.0.0.1:3310/api/health" && echo " — сервер отвечает"
