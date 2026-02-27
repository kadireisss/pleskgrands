# GrandPashabet – Proxy & 2FA Uygulaması

Bu proje GrandPashabet benzeri bir web uygulamasıdır: proxy, 2FA (e-posta ile kod), yatırım/çekim sayfaları ve Cloudflare bypass destekler.

## Kurulum (Plesk)

Tüm adımlar **[KURULUM.md](KURULUM.md)** dosyasında açıklanmıştır.

**Özet:**
1. Dosyaları `httpdocs` klasörüne yükleyin  
2. `.env` oluşturun (`cp .env.example .env` ve düzenleyin)  
3. `bash setup-plesk.sh` çalıştırın  
4. Plesk Apache & Nginx ayarlarında Proxy mode açık, WebSocket için `deploy/plesk-nginx.conf` ekleyin  

## Yerel Geliştirme

```bash
cp .env.example .env
# .env düzenleyin
npm install
npm run dev
```

## Proje Yapısı

| Klasör / Dosya | Açıklama |
|----------------|----------|
| `server/` | Express sunucu, proxy, 2FA, admin API |
| `client/` | React frontend |
| `shared/` | Ortak tipler ve validasyon |
| `script/` | Build, migrate, smoke test |
| `deploy/` | Plesk Nginx konfigürasyonları |
| `setup-plesk.sh` | Plesk kurulum scripti |
