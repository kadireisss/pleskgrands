import { Solver } from "2captcha";

const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY || "";

const solver = new Solver(CAPTCHA_API_KEY);

export interface CaptchaSolveResult {
  success: boolean;
  token?: string;
  error?: string;
}

export async function solveRecaptchaV3(
  pageUrl: string,
  siteKey: string,
  action: string = "login",
  minScore: number = 0.9
): Promise<CaptchaSolveResult> {
  if (!CAPTCHA_API_KEY) {
    return { success: false, error: "CAPTCHA_API_KEY not configured" };
  }

  console.log(`[2CAPTCHA] Solving reCAPTCHA v3 for: ${pageUrl}`);
  console.log(`[2CAPTCHA] Site key: ${siteKey}`);
  console.log(`[2CAPTCHA] Action: ${action}`);
  console.log(`[2CAPTCHA] Min score: ${minScore}`);

  try {
    const result = await solver.recaptcha(siteKey, pageUrl, {
      version: "v3",
      action: action,
      min_score: minScore,
    });

    console.log(`[2CAPTCHA] Solved! Token: ${result.data.substring(0, 50)}...`);
    return { success: true, token: result.data };
  } catch (error: any) {
    console.error(`[2CAPTCHA] Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export async function solveRecaptchaV2(
  pageUrl: string,
  siteKey: string
): Promise<CaptchaSolveResult> {
  if (!CAPTCHA_API_KEY) {
    return { success: false, error: "CAPTCHA_API_KEY not configured" };
  }

  console.log(`[2CAPTCHA] Solving reCAPTCHA v2 for: ${pageUrl}`);
  console.log(`[2CAPTCHA] Site key: ${siteKey}`);

  try {
    const result = await solver.recaptcha(siteKey, pageUrl);

    console.log(`[2CAPTCHA] Solved! Token: ${result.data.substring(0, 50)}...`);
    return { success: true, token: result.data };
  } catch (error: any) {
    console.error(`[2CAPTCHA] Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export async function solveTurnstile(
  pageUrl: string,
  siteKey: string,
  action?: string
): Promise<CaptchaSolveResult> {
  if (!CAPTCHA_API_KEY) {
    return { success: false, error: "CAPTCHA_API_KEY not configured" };
  }

  console.log(`[2CAPTCHA] Solving Turnstile for: ${pageUrl}`);
  console.log(`[2CAPTCHA] Site key: ${siteKey}`);

  try {
    // 2captcha-ts veya benzeri kütüphanelerde turnstile metodu olmayabilir,
    // bu yüzden genel solve metodu veya varsa turnstile metodunu kullanıyoruz.
    // Kütüphane tipine göre uyarlama yapıyoruz.
    const result = await (solver as any).turnstile({
      sitekey: siteKey,
      pageurl: pageUrl,
      action: action
    });

    console.log(`[2CAPTCHA] Solved! Token: ${result.data.substring(0, 50)}...`);
    return { success: true, token: result.data };
  } catch (error: any) {
    console.error(`[2CAPTCHA] Turnstile Error: ${error.message}`);
    // Fallback: Eğer kütüphane metodu yoksa hata dönebilir
    return { success: false, error: error.message };
  }
}

export function isCaptchaConfigured(): boolean {
  return !!CAPTCHA_API_KEY;
}

export async function getBalance(): Promise<number> {
  if (!CAPTCHA_API_KEY) {
    return 0;
  }
  
  try {
    const balance = await solver.balance();
    return balance;
  } catch {
    return 0;
  }
}
