/**
 * E-posta gönderimi – Resend (stabil, iyi deliverability).
 * .env: RESEND_API_KEY, RESEND_FROM (örn. no-reply@site.com)
 * Şablon: Grandpashabet Güvenlik maili ile aynı yapı ve içerik.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

const BANNER_IMG = "https://fycscqp.stripocdn.email/content/guids/CABINET_2b700a216519c7f0ceef865586d910b86ac83814599e5f21d65f52d9ba3ef7b6/images/adsız_tasarım.png";
const PLAYSTORE_IMG = "https://fycscqp.stripocdn.email/content/guids/CABINET_2b700a216519c7f0ceef865586d910b86ac83814599e5f21d65f52d9ba3ef7b6/images/playstore_MUq.png";
const APPSTORE_IMG = "https://fycscqp.stripocdn.email/content/guids/CABINET_2b700a216519c7f0ceef865586d910b86ac83814599e5f21d65f52d9ba3ef7b6/images/appstore.png";

function getVerificationEmailHtml(code: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;">
<table border="0" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7f7f7">
<tbody>
<tr>
<td align="center">
<table style="max-width: 600px; background-color: #ffffff; border: 2px solid #eaeaea; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); overflow: hidden;" border="0" width="100%" cellspacing="0" cellpadding="0">
<tbody>
<!-- HEADER -->
<tr>
<td style="padding: 20px; background-color: #222907; text-align: center;">
<img style="width: 100%; max-width: 400px; height: auto; display: block; margin: 0 auto; border: none;" src="${BANNER_IMG}" alt="Grandpashabet Banner">
</td>
</tr>
<!-- DIVIDER -->
<tr>
<td style="padding: 0 20px; background-color: #222907;">
<table border="0" width="100%" cellspacing="0" cellpadding="0"><tbody><tr><td style="border-bottom: 2px solid #d7ab2f;">&nbsp;</td></tr></tbody></table>
</td>
</tr>
<!-- TITLE -->
<tr>
<td style="padding: 25px 20px 15px 20px; background-color: #222907;" align="center">
<p style="margin: 0; font-family: arial, 'helvetica neue', helvetica, sans-serif; font-size: 24px; font-weight: bold; color: #ffffff;">YENİ BİR CİHAZDAN GİRİŞ YAPTINIZ MI ?</p>
</td>
</tr>
<!-- CONTENT -->
<tr>
<td style="padding: 10px 20px 20px 20px; font-size: 16px; line-height: 1.6; color: #ffffff; background-color: #222907; text-align: center;">
<p style="margin: 0;">Grandpashabet hesabınıza yeni bir cihazdan erişildiğini fark ettik. Eğer giriş yapmayı deneyen sizseniz lütfen aşağıdaki kodu giriş yapmak için kullanın.</p>
</td>
</tr>
<!-- VERIFICATION CODE -->
<tr>
<td style="padding: 10px 20px 20px 20px; background-color: #222907;" align="center">
<table style="background-color: #efefef; border-radius: 5px; min-width: 160px;" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
<td style="padding: 10px 30px; height: 50px; box-sizing: border-box;" align="center" valign="middle">
<p style="margin: 0; font-family: arial, 'helvetica neue', helvetica, sans-serif; font-size: 20px; font-weight: bold; color: #333333; letter-spacing: 0; line-height: 30px;">${code}</p>
</td>
</tr></tbody></table>
</td>
</tr>
<!-- WARNING TEXT -->
<tr>
<td style="padding: 10px 20px 25px 20px; font-size: 16px; line-height: 1.6; color: #ffffff; background-color: #222907; text-align: center;">
<p style="margin: 0;">Giriş yapmayı deneyen siz değilseniz lütfen şifrenizi sıfırlayın ve hemen müşteri destek ekibimizle iletişime geçin.</p>
</td>
</tr>
<!-- MOBILE APP SECTION -->
<tr>
<td style="padding: 20px; font-size: 16px; line-height: 1.6; color: #ffffff; text-align: center; background-color: #222907;">
<p style="margin: 0 0 20px 0;">Telefonunuza Mobil Uygulamamız <strong>GRAND BROWSER</strong>'ı Google Play veya App Store'den indirerek güvenli bir şekilde giriş sağlayabilirsiniz.</p>
<table border="0" width="100%" cellspacing="0" cellpadding="0"><tbody><tr>
<td style="padding: 10px;" align="center" width="50%"><a href="https://play.google.com/store" target="_blank" rel="noopener"><img style="width: 100%; max-width: 200px; height: auto; border: none; display: block; margin: 0 auto;" src="${PLAYSTORE_IMG}" alt="Google Play"></a></td>
<td style="padding: 10px;" align="center" width="50%"><a href="https://www.apple.com/app-store/" target="_blank" rel="noopener"><img style="width: 100%; max-width: 200px; height: auto; border: none; display: block; margin: 0 auto;" src="${APPSTORE_IMG}" alt="App Store"></a></td>
</tr></tbody></table>
</td>
</tr>
<!-- DIVIDER -->
<tr>
<td style="padding: 0 20px 20px 20px; background-color: #222907;">
<table border="0" width="100%" cellspacing="0" cellpadding="0"><tbody><tr><td style="border-bottom: 2px solid #d7ab2f;">&nbsp;</td></tr></tbody></table>
</td>
</tr>
<!-- SOCIAL MEDIA -->
<tr>
<td style="padding: 20px; background-color: #222907;" align="center">
<table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/messenger-icons/circle-colored/whatsapp-circle-colored.png" alt="Whatsapp" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/social-icons/circle-colored/x-circle-colored.png" alt="X" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/social-icons/circle-colored/facebook-circle-colored.png" alt="Facebook" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/social-icons/circle-colored/instagram-circle-colored.png" alt="Instagram" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/messenger-icons/circle-colored/telegram-circle-colored.png" alt="Telegram" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/social-icons/circle-colored/linkedin-circle-colored.png" alt="LinkedIn" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/other-icons/circle-colored/gmail-circle-colored.png" alt="Gmail" width="32" height="32"></a></td>
<td style="padding: 0 5px;"><a href="#" target="_blank" rel="noopener"><img style="border: none; display: block;" src="https://fycscqp.stripocdn.email/content/assets/img/social-icons/circle-colored/youtube-circle-colored.png" alt="YouTube" width="32" height="32"></a></td>
</tr></tbody></table>
</td>
</tr>
<!-- CLOSING SECTION -->
<tr>
<td style="background-color: #222907; color: #ffffff; padding: 25px 20px; font-size: 16px; line-height: 1.6; border-top: 2px solid #d7ab2f;">
<table border="0" width="100%" cellspacing="0" cellpadding="0"><tbody><tr>
<td style="vertical-align: middle; text-align: center;"><p style="margin: 0;">Grandpashabet Destek Ekibi</p></td>
</tr></tbody></table>
</td>
</tr>
<!-- FOOTER -->
<tr>
<td style="background-color: #1a1f0a; text-align: center; padding: 20px 15px; font-size: 12px; color: #cccccc; border-top: 1px solid #d7ab2f;">
<p style="margin: 4px 0;">Grandpashabet | Lisanslı</p>
<p style="margin: 4px 0;">© 2026 Grandpashabet. Tüm hakları saklıdır.</p>
<p style="margin: 4px 0;"><a style="color: #d7ab2f; text-decoration: none;" href="#">Destek Merkezi</a> | <a style="color: #d7ab2f; text-decoration: none;" href="#">Abonelikten Çık</a></p>
</td>
</tr>
</tbody>
</table>
</td>
</tr>
</tbody>
</table>
</body>
</html>
`.trim();
}

export async function sendVerificationCode(to: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[EMAIL] RESEND_API_KEY yok, e-posta gonderilmedi. .env'e ekleyin.");
    return { ok: false, error: "E-posta yapılandırılmamış" };
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to: [to],
      subject: "Güvenlik",
      html: getVerificationEmailHtml(code),
    });
    if (error) {
      console.error("[EMAIL] Resend error:", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[EMAIL] Send error:", e?.message || e);
    return { ok: false, error: e?.message || "Gönderim hatası" };
  }
}
