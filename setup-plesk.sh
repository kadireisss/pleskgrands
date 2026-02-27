#!/bin/bash
# PLESK / Linux kurulum scripti
# Kullanim: cd /var/www/vhosts/DOMAIN/httpdocs && bash setup-plesk.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}   $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}     $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}   $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}   $*"; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo "========================================"
echo "  GRANDPASHABET - PLESK KURULUMU"
echo "========================================"
echo ""

# 1) Node.js
info "Node.js kontrol ediliyor..."
if ! command -v node &>/dev/null; then
  fail "Node.js bulunamadi. Plesk Node.js extension veya 'apt install nodejs' ile kurun."
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  fail "Node.js 18+ gerekli. Mevcut: $(node -v)"
fi
ok "Node.js $(node -v)"

# 2) .env
info ".env kontrol ediliyor..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env olusturuldu. LUTFEN DUZENLEYIN: nano .env"
  else
    fail ".env ve .env.example yok!"
  fi
fi
ok ".env mevcut"

# 3) CRLF -> LF (Windows'tan yuklenen dosyalar icin)
info "Satir sonu kontrolu..."
if grep -q $'\r' package.json 2>/dev/null; then
  if command -v dos2unix &>/dev/null; then
    find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" -o -name "*.sh" -o -name "*.json" \) ! -path "./node_modules/*" -exec dos2unix {} \; 2>/dev/null || true
  else
    find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" -o -name "*.sh" -o -name "*.json" \) ! -path "./node_modules/*" -exec sed -i 's/\r$//' {} \; 2>/dev/null || true
  fi
  ok "CRLF donusturuldu"
else
  ok "Satir sonlari uygun"
fi

# 4) Chrome & Xvfb (Headful CF Bypass icin)
info "Chrome ve Xvfb kontrol ediliyor..."
CHROME_INSTALLED=false
if command -v google-chrome-stable &>/dev/null || command -v google-chrome &>/dev/null || command -v chromium &>/dev/null || command -v chromium-browser &>/dev/null; then
  CHROME_INSTALLED=true
  CHROME_PATH=$(which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium 2>/dev/null || which chromium-browser 2>/dev/null)
  ok "Chrome/Chromium bulundu: $CHROME_PATH"
else
  warn "Chrome/Chromium bulunamadi. Kuruluyor..."
  if command -v apt-get &>/dev/null; then
    apt-get update -qq
    # Oncelikle Google Chrome (gercek TLS fingerprint icin ideal)
    if ! apt-get install -y google-chrome-stable 2>/dev/null; then
      # Chrome repo yoksa ekle
      wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - 2>/dev/null || true
      echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list 2>/dev/null || true
      apt-get update -qq 2>/dev/null || true
      if ! apt-get install -y google-chrome-stable 2>/dev/null; then
        warn "Google Chrome kurulamadi. Chromium deneniyor..."
        apt-get install -y chromium chromium-browser 2>/dev/null || apt-get install -y chromium 2>/dev/null || warn "Chromium da kurulamadi!"
      fi
    fi
  elif command -v yum &>/dev/null; then
    yum install -y chromium 2>/dev/null || warn "Chromium kurulamadi (yum)"
  fi
fi

# Xvfb kurulumu (headful modda ekran gerektigi icin)
if ! command -v Xvfb &>/dev/null; then
  info "Xvfb kuruluyor (headful Chrome icin sanal ekran)..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y xvfb 2>/dev/null || warn "Xvfb kurulamadi"
  elif command -v yum &>/dev/null; then
    yum install -y xorg-x11-server-Xvfb 2>/dev/null || warn "Xvfb kurulamadi"
  fi
fi

if command -v Xvfb &>/dev/null; then
  ok "Xvfb hazir (headful CF bypass aktif)"
else
  warn "Xvfb bulunamadi. CF_HEADLESS=true ile headless mod kullanilacak."
fi

# Gerekli fontlar
if command -v apt-get &>/dev/null; then
  apt-get install -y fonts-liberation fonts-noto-color-emoji 2>/dev/null || true
fi

# 5) npm install
info "Bagimliliklar yukleniyor..."
export CI=1
npm install --production=false
ok "npm install tamamlandi"

# 6) Build
info "Proje derleniyor (client + server)..."
export NODE_ENV=production
npm run build
if [ ! -f "dist/index.cjs" ]; then
  fail "Build basarisiz! dist/index.cjs yok."
fi
if [ ! -d "dist/public" ]; then
  fail "Client build basarisiz! dist/public yok."
fi
ok "Build tamamlandi"

# 7) Dizinler
mkdir -p logs data
ok "logs/ ve data/ dizinleri hazir"

# 8) Veritabani (drizzle-kit henuz mevcut)
info "Veritabani semasi..."
if grep -q 'DATABASE_URL=postgresql://' .env 2>/dev/null && ! grep -q 'DATABASE_URL=postgresql://USER' .env 2>/dev/null; then
  if npx drizzle-kit push --force 2>/dev/null; then
    ok "Veritabani tablolari guncellendi"
  else
    node script/migrate-2fa.mjs 2>/dev/null || warn "DB guncelleme atlandi. Manuel: npm run db:push"
  fi
else
  warn "DATABASE_URL ayarlanmamis. .env icinde duzenleyin."
fi

# 9) Dev dependencies temizligi (drizzle sonrasi)
info "Dev bagimliliklari kaldiriliyor..."
npm prune --omit=dev 2>/dev/null || true
ok "Production-only bagimliliklari kaldi"

# 10) PM2 veya node
info "Uygulama baslatma..."
if command -v pm2 &>/dev/null; then
  pm2 delete hocam-merhaba 2>/dev/null || true
  pm2 start ecosystem.config.cjs --env production
  ok "PM2 ile baslatildi: hocam-merhaba"
  echo "  pm2 save && pm2 startup  (kalici olarak kaydetmek icin)"
else
  ok "Kurulum tamamlandi. Baslatmak icin:"
  echo "    npm run start"
  echo "  veya PM2 icin: npm install -g pm2 && pm2 start ecosystem.config.cjs"
fi

echo ""
echo "============================================"
echo -e "  ${GREEN}KURULUM TAMAMLANDI!${NC}"
echo "============================================"
echo ""
echo "  Healthcheck: curl http://127.0.0.1:5000/healthz"
echo "  Proxy:       https://DOMAIN/tr/"
echo "  Admin:       https://DOMAIN/admin  (admin / admin123)"
echo ""
