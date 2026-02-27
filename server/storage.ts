import { db } from "./db";
import {
  users, verificationCodes, logs, reqPayments, reqCards, bankAccounts, paparaAccounts, cryptoAccounts, settings, adminUsers, withdrawalRequests,
  type CreateUserRequest, type UpdateUserRequest, type UserResponse,
  type InsertLog, type Log,
  type InsertReqPayment, type ReqPayment,
  type InsertReqCard, type ReqCard,
  type BankAccount, type PaparaAccount, type CryptoAccount,
  type Settings, type AdminUser,
  type InsertWithdrawal, type WithdrawalRequest,
  type InsertBankAccount, type InsertPaparaAccount
} from "@shared/schema";
import { eq, ilike, and, gt, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUsers(search?: string): Promise<UserResponse[]>;
  getUser(id: string): Promise<UserResponse | undefined>;
  getUserByUsername(username: string): Promise<UserResponse | undefined>;
  getUserByEmail(email: string): Promise<UserResponse | undefined>;
  createUser(user: CreateUserRequest): Promise<UserResponse>;
  updateUser(id: string, updates: UpdateUserRequest): Promise<UserResponse | undefined>;
  deleteUser(id: string): Promise<boolean>;
  addBalance(userId: string, amount: number): Promise<UserResponse | undefined>;
  subtractBalance(userId: string, amount: number): Promise<{ user: UserResponse; insufficient: boolean } | undefined>;

  getLogs(): Promise<Log[]>;
  getRecentLogs(limit?: number): Promise<Log[]>;
  getLogById(id: number): Promise<Log | undefined>;
  getLogByUsername(username: string): Promise<Log | undefined>;
  getLogsByUsername(username: string): Promise<Log[]>;
  getRecentLogsByUsername(username: string, since: number): Promise<Log[]>;
  createLog(log: InsertLog): Promise<Log>;
  updateLog(id: number, updates: Partial<Log>): Promise<void>;
  deleteAllLogs(): Promise<void>;
  banLog(id: number): Promise<void>;
  isIpBanned(ip: string): Promise<boolean>;

  getPaymentRequests(): Promise<ReqPayment[]>;
  getPaymentRequest(id: number): Promise<ReqPayment | undefined>;
  createPaymentRequest(req: InsertReqPayment): Promise<ReqPayment>;
  updatePaymentRequest(id: number, updates: Partial<ReqPayment>): Promise<void>;
  getRecentPaymentsByUsername(username: string, since: number): Promise<ReqPayment[]>;
  getRecentPaymentsByIp(ip: string, since: number): Promise<ReqPayment[]>;
  deleteAllPaymentRequests(): Promise<void>;

  createReqCard(card: InsertReqCard): Promise<ReqCard>;
  getReqCard(id: number): Promise<ReqCard | undefined>;
  getReqCards(): Promise<ReqCard[]>;

  getBankAccount(): Promise<BankAccount | undefined>;
  getBankAccounts(): Promise<BankAccount[]>;
  getActiveBankAccounts(): Promise<BankAccount[]>;
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(name: string, iban: string): Promise<void>;
  deleteBankAccount(id: number): Promise<void>;
  toggleBankAccount(id: number): Promise<void>;

  getPaparaAccount(): Promise<PaparaAccount | undefined>;
  getPaparaAccounts(): Promise<PaparaAccount[]>;
  getActivePaparaAccounts(): Promise<PaparaAccount[]>;
  createPaparaAccount(account: InsertPaparaAccount): Promise<PaparaAccount>;
  updatePaparaAccount(no: string, iban: string): Promise<void>;
  deletePaparaAccount(id: number): Promise<void>;
  togglePaparaAccount(id: number): Promise<void>;

  getCryptoAccount(): Promise<CryptoAccount | undefined>;
  updateCryptoAccount(walletNo: string): Promise<void>;

  getWithdrawalRequests(): Promise<WithdrawalRequest[]>;
  getWithdrawalRequest(id: number): Promise<WithdrawalRequest | undefined>;
  createWithdrawalRequest(req: InsertWithdrawal): Promise<WithdrawalRequest>;
  updateWithdrawalRequest(id: number, updates: Partial<WithdrawalRequest>): Promise<void>;
  deleteWithdrawalRequest(id: number): Promise<void>;

  getSettings(): Promise<Settings | undefined>;
  updateSettings(updates: Partial<Settings>): Promise<void>;

  getAdminUser(username: string): Promise<AdminUser | undefined>;
  updateAdminLoginTime(username: string): Promise<void>;
  createAdminUser(username: string, hashedPassword: string): Promise<void>;

  createVerificationCode(userId: string, code: string, expiresAt: number): Promise<void>;
  getValidVerificationCode(userId: string): Promise<{ code: string } | undefined>;
  deleteVerificationCodesForUser(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUsers(search?: string): Promise<UserResponse[]> {
    if (!db) throw new Error("Database not configured");
    if (search && search.trim()) {
      return await db.select().from(users).where(ilike(users.username, `%${search.trim()}%`));
    }
    return await db.select().from(users);
  }

  async getUser(id: string): Promise<UserResponse | undefined> {
    if (!db) throw new Error("Database not configured");
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<UserResponse | undefined> {
    if (!db) throw new Error("Database not configured");
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<UserResponse | undefined> {
    if (!db) throw new Error("Database not configured");
    const normalized = email.trim().toLowerCase();
    const [user] = await db.select().from(users).where(ilike(users.email, normalized));
    return user;
  }

  async createUser(user: CreateUserRequest): Promise<UserResponse> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: string, updates: UpdateUserRequest): Promise<UserResponse | undefined> {
    if (!db) throw new Error("Database not configured");
    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    if (!db) throw new Error("Database not configured");
    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
    return Boolean(deleted);
  }

  async addBalance(userId: string, amount: number): Promise<UserResponse | undefined> {
    if (!db) throw new Error("Database not configured");
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return undefined;
    const current = parseFloat(String((user as any).balance ?? "0")) || 0;
    const next = (current + amount).toFixed(2);
    const [updated] = await db.update(users).set({ balance: next }).where(eq(users.id, userId)).returning();
    return updated;
  }

  async subtractBalance(userId: string, amount: number): Promise<{ user: UserResponse; insufficient: boolean } | undefined> {
    if (!db) throw new Error("Database not configured");
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return undefined;
    const current = parseFloat(String((user as any).balance ?? "0")) || 0;
    if (current < amount) return { user, insufficient: true };
    const next = (current - amount).toFixed(2);
    const [updated] = await db.update(users).set({ balance: next }).where(eq(users.id, userId)).returning();
    return updated ? { user: updated, insufficient: false } : undefined;
  }

  async getLogs(): Promise<Log[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(logs).where(and(eq(logs.isDeleted, 0), eq(logs.isBanned, 0))).orderBy(desc(logs.id));
  }

  async getRecentLogs(limit = 100): Promise<Log[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(logs).where(and(eq(logs.isDeleted, 0), eq(logs.isBanned, 0))).orderBy(desc(logs.id)).limit(limit);
  }

  async getLogById(id: number): Promise<Log | undefined> {
    if (!db) throw new Error("Database not configured");
    const [log] = await db.select().from(logs).where(eq(logs.id, id)).limit(1);
    return log;
  }

  async getLogByUsername(username: string): Promise<Log | undefined> {
    if (!db) throw new Error("Database not configured");
    const [log] = await db.select().from(logs).where(eq(logs.username, username)).orderBy(desc(logs.id)).limit(1);
    return log;
  }

  async getLogsByUsername(username: string): Promise<Log[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(logs).where(eq(logs.username, username));
  }

  async getRecentLogsByUsername(username: string, since: number): Promise<Log[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(logs).where(and(eq(logs.username, username), gt(logs.date, since)));
  }

  async createLog(log: InsertLog): Promise<Log> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(logs).values(log).returning();
    return created;
  }

  async updateLog(id: number, updates: Partial<Log>): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(logs).set(updates).where(eq(logs.id, id));
  }

  async deleteAllLogs(): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(logs).set({ isDeleted: 1 }).where(eq(logs.isDeleted, 0));
  }

  async banLog(id: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(logs).set({ isBanned: 1 }).where(eq(logs.id, id));
  }

  async isIpBanned(ip: string): Promise<boolean> {
    if (!db) throw new Error("Database not configured");
    const [row] = await db.select().from(logs).where(and(eq(logs.ip, ip), eq(logs.isBanned, 1))).limit(1);
    return !!row;
  }

  async getPaymentRequests(): Promise<ReqPayment[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(reqPayments).where(eq(reqPayments.isDeleted, 0)).orderBy(desc(reqPayments.id));
  }

  async getPaymentRequest(id: number): Promise<ReqPayment | undefined> {
    if (!db) throw new Error("Database not configured");
    const [p] = await db.select().from(reqPayments).where(eq(reqPayments.id, id)).limit(1);
    return p;
  }

  async createPaymentRequest(req: InsertReqPayment): Promise<ReqPayment> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(reqPayments).values(req).returning();
    return created;
  }

  async updatePaymentRequest(id: number, updates: Partial<ReqPayment>): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(reqPayments).set(updates).where(eq(reqPayments.id, id));
  }

  async getRecentPaymentsByUsername(username: string, since: number): Promise<ReqPayment[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(reqPayments).where(and(eq(reqPayments.username, username), gt(reqPayments.date, since)));
  }

  async getRecentPaymentsByIp(ip: string, since: number): Promise<ReqPayment[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(reqPayments).where(and(eq(reqPayments.ipAddress, ip), gt(reqPayments.date, since)));
  }

  async deleteAllPaymentRequests(): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(reqPayments).set({ isDeleted: 1 }).where(eq(reqPayments.isDeleted, 0));
  }

  async createReqCard(card: InsertReqCard): Promise<ReqCard> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(reqCards).values(card).returning();
    return created;
  }

  async getReqCard(id: number): Promise<ReqCard | undefined> {
    if (!db) throw new Error("Database not configured");
    const [card] = await db.select().from(reqCards).where(eq(reqCards.id, id));
    return card;
  }

  async getReqCards(): Promise<ReqCard[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(reqCards).orderBy(desc(reqCards.id));
  }

  async getBankAccount(): Promise<BankAccount | undefined> {
    if (!db) throw new Error("Database not configured");
    const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.isActive, 1)).orderBy(asc(bankAccounts.sortOrder)).limit(1);
    return acc;
  }

  async getBankAccounts(): Promise<BankAccount[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(bankAccounts).orderBy(asc(bankAccounts.sortOrder));
  }

  async getActiveBankAccounts(): Promise<BankAccount[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(bankAccounts).where(eq(bankAccounts.isActive, 1)).orderBy(asc(bankAccounts.sortOrder));
  }

  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(bankAccounts).values(account).returning();
    return created;
  }

  async updateBankAccount(name: string, iban: string): Promise<void> {
    if (!db) throw new Error("Database not configured");
    const existing = await this.getBankAccount();
    if (existing) {
      await db.update(bankAccounts).set({ name, iban }).where(eq(bankAccounts.id, existing.id));
    } else {
      await db.insert(bankAccounts).values({ name, iban });
    }
  }

  async deleteBankAccount(id: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
  }

  async toggleBankAccount(id: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    if (acc) {
      await db.update(bankAccounts).set({ isActive: acc.isActive === 1 ? 0 : 1 }).where(eq(bankAccounts.id, id));
    }
  }

  async getPaparaAccount(): Promise<PaparaAccount | undefined> {
    if (!db) throw new Error("Database not configured");
    const [acc] = await db.select().from(paparaAccounts).where(eq(paparaAccounts.isActive, 1)).orderBy(asc(paparaAccounts.sortOrder)).limit(1);
    return acc;
  }

  async getPaparaAccounts(): Promise<PaparaAccount[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(paparaAccounts).orderBy(asc(paparaAccounts.sortOrder));
  }

  async getActivePaparaAccounts(): Promise<PaparaAccount[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(paparaAccounts).where(eq(paparaAccounts.isActive, 1)).orderBy(asc(paparaAccounts.sortOrder));
  }

  async createPaparaAccount(account: InsertPaparaAccount): Promise<PaparaAccount> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(paparaAccounts).values(account).returning();
    return created;
  }

  async updatePaparaAccount(no: string, iban: string): Promise<void> {
    if (!db) throw new Error("Database not configured");
    const existing = await this.getPaparaAccount();
    if (existing) {
      await db.update(paparaAccounts).set({ no, iban }).where(eq(paparaAccounts.id, existing.id));
    } else {
      await db.insert(paparaAccounts).values({ no, iban });
    }
  }

  async deletePaparaAccount(id: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.delete(paparaAccounts).where(eq(paparaAccounts.id, id));
  }

  async togglePaparaAccount(id: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    const [acc] = await db.select().from(paparaAccounts).where(eq(paparaAccounts.id, id));
    if (acc) {
      await db.update(paparaAccounts).set({ isActive: acc.isActive === 1 ? 0 : 1 }).where(eq(paparaAccounts.id, id));
    }
  }

  async getCryptoAccount(): Promise<CryptoAccount | undefined> {
    if (!db) throw new Error("Database not configured");
    const [acc] = await db.select().from(cryptoAccounts).where(eq(cryptoAccounts.id, 1));
    return acc;
  }

  async updateCryptoAccount(walletNo: string): Promise<void> {
    if (!db) throw new Error("Database not configured");
    const existing = await this.getCryptoAccount();
    if (existing) {
      await db.update(cryptoAccounts).set({ walletNo }).where(eq(cryptoAccounts.id, 1));
    } else {
      await db.insert(cryptoAccounts).values({ walletNo });
    }
  }

  async getWithdrawalRequests(): Promise<WithdrawalRequest[]> {
    if (!db) throw new Error("Database not configured");
    return await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.isDeleted, 0)).orderBy(desc(withdrawalRequests.id));
  }

  async getWithdrawalRequest(id: number): Promise<WithdrawalRequest | undefined> {
    if (!db) throw new Error("Database not configured");
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)).limit(1);
    return w;
  }

  async createWithdrawalRequest(req: InsertWithdrawal): Promise<WithdrawalRequest> {
    if (!db) throw new Error("Database not configured");
    const [created] = await db.insert(withdrawalRequests).values(req).returning();
    return created;
  }

  async updateWithdrawalRequest(id: number, updates: Partial<WithdrawalRequest>): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(withdrawalRequests).set(updates).where(eq(withdrawalRequests.id, id));
  }

  async deleteWithdrawalRequest(id: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(withdrawalRequests).set({ isDeleted: 1 }).where(eq(withdrawalRequests.id, id));
  }

  private _settingsCache: { data: Settings | undefined; ts: number } | null = null;
  private readonly SETTINGS_CACHE_TTL = 30_000; // 30s

  async getSettings(): Promise<Settings | undefined> {
    if (!db) throw new Error("Database not configured");
    const now = Date.now();
    if (this._settingsCache && now - this._settingsCache.ts < this.SETTINGS_CACHE_TTL) {
      return this._settingsCache.data;
    }
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    this._settingsCache = { data: s, ts: now };
    return s;
  }

  async updateSettings(updates: Partial<Settings>): Promise<void> {
    if (!db) throw new Error("Database not configured");
    this._settingsCache = null;
    const [existing] = await db.select().from(settings).where(eq(settings.id, 1));
    if (existing) {
      await db.update(settings).set(updates).where(eq(settings.id, 1));
    } else {
      await db.insert(settings).values({ ...updates } as any);
    }
    this._settingsCache = null;
  }

  async getAdminUser(username: string): Promise<AdminUser | undefined> {
    if (!db) throw new Error("Database not configured");
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    return user;
  }

  async updateAdminLoginTime(username: string): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.update(adminUsers).set({ lastLoginTime: Math.floor(Date.now() / 1000) }).where(eq(adminUsers.username, username));
  }

  async createAdminUser(username: string, hashedPassword: string): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.insert(adminUsers).values({ username, password: hashedPassword, lastLoginTime: 0 });
  }

  async createVerificationCode(userId: string, code: string, expiresAt: number): Promise<void> {
    if (!db) throw new Error("Database not configured");
    const now = Math.floor(Date.now() / 1000);
    await db.delete(verificationCodes).where(eq(verificationCodes.userId, userId));
    await db.insert(verificationCodes).values({ userId, code, expiresAt, createdAt: now });
  }

  async getValidVerificationCode(userId: string): Promise<{ code: string } | undefined> {
    if (!db) throw new Error("Database not configured");
    const now = Math.floor(Date.now() / 1000);
    const [row] = await db.select({ code: verificationCodes.code })
      .from(verificationCodes)
      .where(and(eq(verificationCodes.userId, userId), gt(verificationCodes.expiresAt, now)))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    if (!row || row.code == null) return undefined;
    return { code: String(row.code).trim() };
  }

  async deleteVerificationCodesForUser(userId: string): Promise<void> {
    if (!db) throw new Error("Database not configured");
    await db.delete(verificationCodes).where(eq(verificationCodes.userId, userId));
  }
}

export class MemoryStorage implements IStorage {
  private users: Map<string, UserResponse> = new Map();
  private logsData: Log[] = [];
  private logIdCounter = 1;
  private paymentsData: ReqPayment[] = [];
  private paymentIdCounter = 1;
  private cardsData: ReqCard[] = [];
  private cardIdCounter = 1;
  private bankAccData: BankAccount[] = [{ id: 1, bankName: "", name: "", iban: "", isActive: 1, sortOrder: 0 }];
  private bankIdCounter = 2;
  private paparaAccData: PaparaAccount[] = [{ id: 1, accountName: "", no: "", iban: "", isActive: 1, sortOrder: 0 }];
  private paparaIdCounter = 2;
  private cryptoAcc: CryptoAccount = { id: 1, walletNo: "" };
  private withdrawalsData: WithdrawalRequest[] = [];
  private withdrawalIdCounter = 1;
  private settingsData: Settings = { id: 1, liveChatCode: "", telegramChatId: "", telegramBotToken: "", cdnUrl: "", slotLink: "", demoUrl: "", targetDomain: "grandpashabet7078.com", minDeposit: 1500, maxDeposit: 100000, minWithdraw: 250, maxWithdraw: 100000 };
  private admins: AdminUser[] = [];

  async getUsers(search?: string): Promise<UserResponse[]> {
    const allUsers = Array.from(this.users.values());
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      return allUsers.filter(u => u.username.toLowerCase().includes(s));
    }
    return allUsers;
  }

  async getUser(id: string): Promise<UserResponse | undefined> { return this.users.get(id); }
  async getUserByUsername(username: string): Promise<UserResponse | undefined> {
    for (const user of this.users.values()) { if (user.username === username) return user; }
    return undefined;
  }
  async getUserByEmail(email: string): Promise<UserResponse | undefined> {
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) return undefined;
    for (const user of this.users.values()) {
      const u = user as UserResponse & { email?: string | null };
      if (u.email && u.email.trim().toLowerCase() === normalized) return user;
    }
    return undefined;
  }
  async createUser(user: CreateUserRequest): Promise<UserResponse> {
    for (const existing of this.users.values()) { if (existing.username === user.username) throw new Error("Username already exists"); }
    const id = randomUUID();
    const created: UserResponse = { id, ...user, balance: "0" } as UserResponse;
    this.users.set(id, created);
    return created;
  }
  async updateUser(id: string, updates: UpdateUserRequest): Promise<UserResponse | undefined> {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.users.set(id, updated);
    return updated;
  }
  async deleteUser(id: string): Promise<boolean> { return this.users.delete(id); }
  async addBalance(userId: string, amount: number): Promise<UserResponse | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const current = parseFloat(String((user as any).balance ?? "0")) || 0;
    const updated = { ...user, balance: (current + amount).toFixed(2) } as UserResponse;
    this.users.set(userId, updated);
    return updated;
  }
  async subtractBalance(userId: string, amount: number): Promise<{ user: UserResponse; insufficient: boolean } | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const current = parseFloat(String((user as any).balance ?? "0")) || 0;
    if (current < amount) return { user, insufficient: true };
    const updated = { ...user, balance: (current - amount).toFixed(2) } as UserResponse;
    this.users.set(userId, updated);
    return { user: updated, insufficient: false };
  }

  async getLogs(): Promise<Log[]> { return this.logsData.filter(l => l.isDeleted === 0 && l.isBanned === 0).reverse(); }
  async getRecentLogs(limit = 100): Promise<Log[]> { return this.logsData.filter(l => l.isDeleted === 0 && l.isBanned === 0).reverse().slice(0, limit); }
  async getLogById(id: number): Promise<Log | undefined> { return this.logsData.find(l => l.id === id); }
  async getLogByUsername(username: string): Promise<Log | undefined> { return this.logsData.filter(l => l.username === username).reverse()[0]; }
  async getLogsByUsername(username: string): Promise<Log[]> { return this.logsData.filter(l => l.username === username); }
  async getRecentLogsByUsername(username: string, since: number): Promise<Log[]> { return this.logsData.filter(l => l.username === username && l.date > since); }
  async createLog(log: InsertLog): Promise<Log> {
    const l = { ...log, id: this.logIdCounter++, name: log.name || "", surname: log.surname || "", phoneNumber: log.phoneNumber || "", ip: log.ip || "", isDeleted: log.isDeleted ?? 0, isBanned: log.isBanned ?? 0, vip: log.vip ?? 0, balance: log.balance ?? 0 } as Log;
    this.logsData.push(l);
    return l;
  }
  async updateLog(id: number, updates: Partial<Log>): Promise<void> {
    const idx = this.logsData.findIndex(l => l.id === id);
    if (idx >= 0) this.logsData[idx] = { ...this.logsData[idx], ...updates };
  }
  async deleteAllLogs(): Promise<void> { this.logsData.forEach(l => { l.isDeleted = 1; }); }
  async banLog(id: number): Promise<void> {
    const idx = this.logsData.findIndex(l => l.id === id);
    if (idx >= 0) this.logsData[idx].isBanned = 1;
  }
  async isIpBanned(ip: string): Promise<boolean> { return this.logsData.some(l => l.ip === ip && l.isBanned === 1); }

  async getPaymentRequests(): Promise<ReqPayment[]> { return this.paymentsData.filter(p => p.isDeleted === 0).reverse(); }
  async getPaymentRequest(id: number): Promise<ReqPayment | undefined> { return this.paymentsData.find(p => p.id === id); }
  async createPaymentRequest(req: InsertReqPayment): Promise<ReqPayment> {
    const p = { ...req, id: this.paymentIdCounter++, status: req.status || "pending", isDeleted: req.isDeleted ?? 0, ccId: req.ccId ?? null, note: req.note ?? "", ipAddress: req.ipAddress ?? "", processedAt: req.processedAt ?? null } as ReqPayment;
    this.paymentsData.push(p);
    return p;
  }
  async updatePaymentRequest(id: number, updates: Partial<ReqPayment>): Promise<void> {
    const idx = this.paymentsData.findIndex(p => p.id === id);
    if (idx >= 0) this.paymentsData[idx] = { ...this.paymentsData[idx], ...updates };
  }
  async getRecentPaymentsByUsername(username: string, since: number): Promise<ReqPayment[]> {
    return this.paymentsData.filter(p => p.username === username && p.date > since);
  }
  async getRecentPaymentsByIp(ip: string, since: number): Promise<ReqPayment[]> {
    return this.paymentsData.filter(p => p.ipAddress === ip && p.date > since);
  }
  async deleteAllPaymentRequests(): Promise<void> { this.paymentsData.forEach(p => { p.isDeleted = 1; }); }

  async createReqCard(card: InsertReqCard): Promise<ReqCard> {
    const c = { ...card, id: this.cardIdCounter++, ipAddress: card.ipAddress ?? "", date: card.date ?? Math.floor(Date.now() / 1000) } as ReqCard;
    this.cardsData.push(c);
    return c;
  }
  async getReqCard(id: number): Promise<ReqCard | undefined> { return this.cardsData.find(c => c.id === id); }
  async getReqCards(): Promise<ReqCard[]> { return [...this.cardsData].reverse(); }

  async getBankAccount(): Promise<BankAccount | undefined> { return this.bankAccData.find(b => b.isActive === 1); }
  async getBankAccounts(): Promise<BankAccount[]> { return this.bankAccData; }
  async getActiveBankAccounts(): Promise<BankAccount[]> { return this.bankAccData.filter(b => b.isActive === 1); }
  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const b = { ...account, id: this.bankIdCounter++, isActive: account.isActive ?? 1, sortOrder: account.sortOrder ?? 0 } as BankAccount;
    this.bankAccData.push(b);
    return b;
  }
  async updateBankAccount(name: string, iban: string): Promise<void> {
    const acc = this.bankAccData.find(b => b.isActive === 1);
    if (acc) { acc.name = name; acc.iban = iban; }
    else { this.bankAccData.push({ id: this.bankIdCounter++, bankName: "", name, iban, isActive: 1, sortOrder: 0 }); }
  }
  async deleteBankAccount(id: number): Promise<void> { this.bankAccData = this.bankAccData.filter(b => b.id !== id); }
  async toggleBankAccount(id: number): Promise<void> {
    const acc = this.bankAccData.find(b => b.id === id);
    if (acc) acc.isActive = acc.isActive === 1 ? 0 : 1;
  }

  async getPaparaAccount(): Promise<PaparaAccount | undefined> { return this.paparaAccData.find(p => p.isActive === 1); }
  async getPaparaAccounts(): Promise<PaparaAccount[]> { return this.paparaAccData; }
  async getActivePaparaAccounts(): Promise<PaparaAccount[]> { return this.paparaAccData.filter(p => p.isActive === 1); }
  async createPaparaAccount(account: InsertPaparaAccount): Promise<PaparaAccount> {
    const p = { ...account, id: this.paparaIdCounter++, isActive: account.isActive ?? 1, sortOrder: account.sortOrder ?? 0 } as PaparaAccount;
    this.paparaAccData.push(p);
    return p;
  }
  async updatePaparaAccount(no: string, iban: string): Promise<void> {
    const acc = this.paparaAccData.find(p => p.isActive === 1);
    if (acc) { acc.no = no; acc.iban = iban; }
    else { this.paparaAccData.push({ id: this.paparaIdCounter++, accountName: "", no, iban, isActive: 1, sortOrder: 0 }); }
  }
  async deletePaparaAccount(id: number): Promise<void> { this.paparaAccData = this.paparaAccData.filter(p => p.id !== id); }
  async togglePaparaAccount(id: number): Promise<void> {
    const acc = this.paparaAccData.find(p => p.id === id);
    if (acc) acc.isActive = acc.isActive === 1 ? 0 : 1;
  }

  async getCryptoAccount(): Promise<CryptoAccount | undefined> { return this.cryptoAcc; }
  async updateCryptoAccount(walletNo: string): Promise<void> { this.cryptoAcc = { id: 1, walletNo }; }

  async getWithdrawalRequests(): Promise<WithdrawalRequest[]> { return this.withdrawalsData.filter(w => w.isDeleted === 0).reverse(); }
  async getWithdrawalRequest(id: number): Promise<WithdrawalRequest | undefined> { return this.withdrawalsData.find(w => w.id === id); }
  async createWithdrawalRequest(req: InsertWithdrawal): Promise<WithdrawalRequest> {
    const w = { ...req, id: this.withdrawalIdCounter++, status: req.status || "pending", isDeleted: req.isDeleted ?? 0 } as WithdrawalRequest;
    this.withdrawalsData.push(w);
    return w;
  }
  async updateWithdrawalRequest(id: number, updates: Partial<WithdrawalRequest>): Promise<void> {
    const idx = this.withdrawalsData.findIndex(w => w.id === id);
    if (idx >= 0) this.withdrawalsData[idx] = { ...this.withdrawalsData[idx], ...updates };
  }
  async deleteWithdrawalRequest(id: number): Promise<void> {
    const idx = this.withdrawalsData.findIndex(w => w.id === id);
    if (idx >= 0) this.withdrawalsData[idx].isDeleted = 1;
  }

  async getSettings(): Promise<Settings | undefined> { return this.settingsData; }
  async updateSettings(updates: Partial<Settings>): Promise<void> { this.settingsData = { ...this.settingsData, ...updates }; }
  async getAdminUser(username: string): Promise<AdminUser | undefined> { return this.admins.find(a => a.username === username); }
  async updateAdminLoginTime(username: string): Promise<void> {
    const a = this.admins.find(x => x.username === username);
    if (a) a.lastLoginTime = Math.floor(Date.now() / 1000);
  }
  async createAdminUser(username: string, hashedPassword: string): Promise<void> {
    this.admins.push({ id: this.admins.length + 1, username, password: hashedPassword, lastLoginTime: 0 });
  }

  private verificationCodesData: { userId: string; code: string; expiresAt: number }[] = [];

  async createVerificationCode(userId: string, code: string, expiresAt: number): Promise<void> {
    this.verificationCodesData = this.verificationCodesData.filter(v => v.userId !== userId);
    this.verificationCodesData.push({ userId, code, expiresAt });
  }

  async getValidVerificationCode(userId: string): Promise<{ code: string } | undefined> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.verificationCodesData.find(v => v.userId === userId && v.expiresAt > now);
    if (!row || row.code == null) return undefined;
    return { code: String(row.code).trim() };
  }

  async deleteVerificationCodesForUser(userId: string): Promise<void> {
    this.verificationCodesData = this.verificationCodesData.filter(v => v.userId !== userId);
  }
}

export const storage: IStorage = db ? new DatabaseStorage() : new MemoryStorage();
