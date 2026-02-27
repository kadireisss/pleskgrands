# GrandPashabet – Plesk Kurulum Rehberi

Bu rehber, projeyi Plesk sunucusunda adım adım kurmanızı sağlar.

---

## Gereksinimler

| Bileşen | Gereksinim |
|---------|------------|
| Node.js | 18 veya üzeri |
| Veritabanı | PostgreSQL (Neon, Supabase vb.) |
| Proxy (CF bypass için) | DataImpulse hesabı |
| Chromium (CF bypass için) | `apt install chromium` |

---

## 1. Dosyaları Yükleme

Projeyi domain `httpdocs` klasörüne kopyalayın:

```
/var/www/vhosts/SITENIZ.com/httpdocs/
```

**Yöntem:** File Manager (zip yükle + aç) veya SFTP/Git.

Klasör yapısı şöyle olmalı:

```
httpdocs/
├── package.json
├── setup-plesk.sh
├── .env.example
├── server/
├── client/
├── shared/
├── script/
├── deploy/
└── ...
```

---

## 2. .env Dosyası

SSH ile bağlanın:

```bash
cd /var/www/vhosts/SITENIZ.com/httpdocs
cp .env.example .env
nano .env
```

**Doldurulması gerekenler:**

| Değişken | Açıklama |
|----------|----------|
| `SESSION_SECRET` | Uzun rastgele string (`openssl rand -hex 32`) |
| `DATABASE_URL` | PostgreSQL bağlantı URL’si |
| `RESEND_API_KEY` | 2FA e-posta için (Resend.com) |
| `PORT` | 5000 (varsayılan) |
| `PROXY_USER` / `PROXY_PASS` | DataImpulse (CF bypass için) |
| `COOKIE_SECURE` | true (HTTPS için) |

Kaydetme: `Ctrl+O` → Enter → `Ctrl+X`

---

## 3. Kurulum Scriptini Çalıştırma

```bash
cd /var/www/vhosts/SITENIZ.com/httpdocs
chmod +x setup-plesk.sh
bash setup-plesk.sh
```

Script şunları yapar:

- Node.js kontrolü (18+)
- `.env` kontrolü
- CRLF → LF dönüşümü
- `npm install`
- `npm run build`
- Veritabanı tabloları
- PM2 ile uygulama başlatma

---

## 4. Plesk Web Sunucu Ayarları

**Domain > Apache & nginx Settings**

### Seçenek A: Plesk Node.js Extension Kullanıyorsanız

1. **Node.js** ayarlarında:
   - **Uygulama URL:** `http://127.0.0.1:5000`
   - **Uygulama kökü:** `/httpdocs`
   - **Başlatma dosyası:** `dist/index.cjs`
   - **Node.js sürümü:** 18 veya 20

2. **Additional Nginx directives** alanına sadece `deploy/plesk-nginx.conf` içeriğini yapıştırın (WebSocket için).

### Seçenek B: PM2 ile Elle Çalıştırıyorsanız

1. **Proxy mode:** AÇIK  
2. **Hedef:** `http://127.0.0.1:5000`
3. **Additional Nginx directives:** `deploy/plesk-nginx.conf` içeriği (sadece WebSocket bloğu)

**Önemli:** "location /" eklemeyin; Plesk zaten ekler, duplicate hatası oluşur.

---

## 5. Doğrulama

```bash
curl http://127.0.0.1:5000/healthz
# {"status":"ok","uptimeSec":...}
```

Tarayıcıdan:

- Site: `https://SITENIZ.com/tr/`
- Admin: `https://SITENIZ.com/admin` (varsayılan: admin / admin123)

---

## Sorun Giderme

### 403 Forbidden

- Proxy mode AÇIK, hedef `http://127.0.0.1:5000` olmalı
- Node çalışıyor mu: `pm2 list` veya `curl http://127.0.0.1:5000/healthz`

### 502 Bad Gateway

- Node çalışıyor mu: `pm2 list`
- Port doğru mu: `.env` içinde `PORT=5000`
- Loglar: `pm2 logs hocam-merhaba`

### "duplicate location" nginx hatası

- Additional Nginx directives içinde `location /` olmamalı
- Sadece `deploy/plesk-nginx.conf` içindeki WebSocket bloğunu kullanın

### CF bypass başarısız

- Chromium: `apt install chromium` ve `.env` içinde `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
- Proxy: `PROXY_USER` ve `PROXY_PASS` dolu olmalı
- Loglar: `pm2 logs` ile hata mesajına bakın

### Node.js sürümü düşük

- Plesk > Araçlar ve Ayarlar > Node.js ile 18+ seçin
- Domain Node.js ayarlarında bu sürümü kullanın

---

## Hızlı Referans

| Komut | Açıklama |
|-------|----------|
| `bash setup-plesk.sh` | Tam kurulum |
| `npm run start` | Uygulamayı başlat |
| `pm2 start ecosystem.config.cjs` | PM2 ile başlat |
| `pm2 logs hocam-merhaba` | Logları görüntüle |
| `pm2 restart hocam-merhaba` | Yeniden başlat |

---

## Ek Notlar

- **PM2 uygulama adı:** `hocam-merhaba` (`ecosystem.config.cjs` içinde tanımlı)
- **Admin varsayılan:** admin / admin123 — ilk girişten sonra şifreyi değiştirin
