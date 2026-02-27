import { storage } from "./storage";

export async function sendTelegram(message: string): Promise<boolean> {
  try {
    const settings = await storage.getSettings();
    if (!settings || !settings.telegramBotToken || !settings.telegramChatId) {
      console.log("[TELEGRAM] Not configured, skipping notification");
      return false;
    }

    const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      console.log(`[TELEGRAM] Failed: ${res.status} ${res.statusText}`);
      return false;
    }

    console.log("[TELEGRAM] Notification sent successfully");
    return true;
  } catch (e: any) {
    console.log(`[TELEGRAM] Error: ${e.message}`);
    return false;
  }
}
