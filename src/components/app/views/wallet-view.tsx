"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight, Info, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { formatETB, formatDateTime } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/en";
import type { TxDTO, WalletDTO } from "@/lib/serialize";
import { cn } from "@/lib/utils";

interface WalletResponse {
  wallet: WalletDTO | null;
  settings: {
    minDepositCents: number;
    maxDepositCents: number;
    minWithdrawalCents: number;
    maxWithdrawalCents: number;
  } | null;
  usage: { depositedTodayCents: number; stakedTodayCents: number } | null;
}

interface TxPage {
  transactions: TxDTO[];
  total: number;
  page: number;
  totalPages: number;
}

type WalletTab = "overview" | "deposit" | "withdraw" | "history";
type WithdrawMethod = "TELEBIRR" | "CBE_BIRR" | "BANK";

const CREDIT_TYPES = new Set(["DEPOSIT", "WIN", "REFUND", "CASHOUT", "BONUS", "ADJUSTMENT"]);
const TX_FILTERS = ["DEPOSIT", "WITHDRAWAL", "BET", "WIN", "BONUS"] as const;

const QUICK_AMOUNTS = [50, 100, 250, 500];
const SMS_REQUIRED = process.env.NEXT_PUBLIC_WITHDRAW_SMS !== "false";

function txStatusBadge(status: string, t: (k: DictKey) => string) {
  const s = status.toUpperCase();
  if (s === "PENDING" || s === "PROCESSING") return <Badge variant="outline">{t("common.pending")}</Badge>;
  if (s === "SUCCESS" || s === "COMPLETED" || s === "SUCCESSFUL")
    return (
      <Badge className="bg-primary/15 text-primary">
        {t("common.success")}
      </Badge>
    );
  if (s === "FAILED" || s === "REJECTED" || s === "CANCELLED") return <Badge variant="destructive">{t("common.failed")}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

function DepositForm({ wallet }: { wallet: WalletResponse }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const min = wallet.settings?.minDepositCents ?? 100;
  const max = wallet.settings?.maxDepositCents ?? 10_000_000;

  // After returning from the mock Chapa checkout: ?deposit=success&tx_ref=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("deposit") === "success") {
      toast.success(t("wallet.depositSuccess"));
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      params.delete("deposit");
      params.delete("tx_ref");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  const submit = async () => {
    const etb = Number.parseFloat(amount);
    if (!Number.isFinite(etb) || etb <= 0) {
      toast.error(t("common.error"));
      return;
    }
    const amountCents = Math.round(etb * 100);
    if (amountCents < min || amountCents > max) {
      toast.error(`${t("wallet.minDeposit")} ${formatETB(min)} · ${t("wallet.maxDeposit")} ${formatETB(max)}`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ checkoutUrl: string; txRef: string }>("/api/deposits", { amountCents });
      toast(t("wallet.redirecting"));
      window.location.href = res.checkoutUrl;
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-gold-foreground" aria-hidden />
        {t("wallet.depositDesc")}
      </p>

      <div className="space-y-2">
        <Label htmlFor="deposit-amount">{t("common.amount")}</Label>
        <Input
          id="deposit-amount"
          inputMode="decimal"
          type="number"
          min={1}
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
          className="h-12 rounded-xl text-lg font-bold"
          required
        />
        <p className="text-xs text-muted-foreground">
          {t("wallet.minDeposit")} {formatETB(min)} · {t("wallet.maxDeposit")} {formatETB(max)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_AMOUNTS.map((v) => (
          <Button
            key={v}
            type="button"
            variant="outline"
            className={cn(
              "h-10 min-w-16 flex-1 rounded-xl tabular-nums",
              amount === String(v) && "border-primary bg-primary/10 text-primary"
            )}
            onClick={() => setAmount(String(v))}
          >
            {v}
          </Button>
        ))}
      </div>

      <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={busy}>
        {busy ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
        ) : null}
        {t("wallet.deposit")}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------

function WithdrawForm({ wallet, onDone }: { wallet: WalletResponse; onDone: () => void }) {
  const { t } = useI18n();
  const navigate = useAppState((s) => s.navigate);
  const { data: session } = useSession();
  const user = session?.user ?? null;
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WithdrawMethod>("TELEBIRR");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [step, setStep] = useState<"form" | "code">("form");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [devCode, setDevCode] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendCode = async () => {
    const etb = Number.parseFloat(amount);
    if (!Number.isFinite(etb) || etb <= 0) {
      toast.error(t("common.error"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ sent: boolean; maskedPhone: string; devOtp?: string }>("/api/withdrawals/code", {
        amountCents: Math.round(etb * 100),
      });
      setSentTo(res.maskedPhone);
      setDevCode(res.devOtp ?? "");
      setCode("");
      setStep("code");
      setCooldown(60);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  const [busy, setBusy] = useState(false);

  const min = wallet.settings?.minWithdrawalCents ?? 10_000;
  const kycOk = user?.kycStatus === "APPROVED";
  const phoneOk = !!user?.phoneVerified;

  const submit = async () => {
    const etb = Number.parseFloat(amount);
    if (!Number.isFinite(etb) || etb <= 0) {
      toast.error(t("common.error"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ status: string; note?: string | null }>("/api/withdrawals", {
        amountCents: Math.round(etb * 100),
        method,
        accountName,
        accountNumber,
        ...(method === "BANK" ? { bankName } : {}),
        otp: code,
      });
      if (res.status === "REJECTED" || res.status === "FAILED") {
        toast.error(t("wd.failed") + (res.note ? " (" + res.note + ")" : ""));
      } else {
        toast.success(res.status === "PAID" || res.status === "PROCESSING" ? t("wd.paid") : t("wd.review"));
      }
      setStep("form");
      setCode("");
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (kycOk && phoneOk) void (!SMS_REQUIRED || step === "code" ? submit() : sendCode());
      }}
    >
      {!kycOk && (
        <Alert className="border-gold/50 bg-gold/10">
          <AlertTriangle className="h-4 w-4 text-gold-foreground" aria-hidden />
          <AlertDescription className="flex items-center justify-between gap-3 text-sm">
            <span>{t("wallet.withdrawRequiresKyc")}</span>
            <Button type="button" size="sm" className="h-9 shrink-0" onClick={() => navigate("profile")}>
              {t("nav.profile")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!phoneOk && (
        <Alert className="border-gold/50 bg-gold/10">
          <AlertTriangle className="h-4 w-4 text-gold-foreground" aria-hidden />
          <AlertDescription className="text-sm">{t("wallet.withdrawRequiresPhone")}</AlertDescription>
        </Alert>
      )}

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-gold-foreground" aria-hidden />
        {t("wallet.withdrawDesc")}
      </p>

      <div className="space-y-2">
        <Label htmlFor="withdraw-amount">{t("common.amount")}</Label>
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          type="number"
          min={1}
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-12 rounded-xl text-lg font-bold"
          required
        />
        <p className="text-xs text-muted-foreground">
          {t("wallet.minWithdrawal")} {formatETB(min)} · {t("wallet.balance")}{" "}
          {formatETB(wallet.wallet?.balanceCents ?? 0)}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="withdraw-method">{t("wallet.method")}</Label>
        <Select value={method} onValueChange={(v) => setMethod(v as WithdrawMethod)}>
          <SelectTrigger id="withdraw-method" className="h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TELEBIRR">{t("wallet.methodTelebirr")}</SelectItem>
            <SelectItem value="CBE_BIRR">{t("wallet.methodCbe")}</SelectItem>
            <SelectItem value="BANK">{t("wallet.methodBank")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="withdraw-account-name">{t("wallet.accountName")}</Label>
        <Input
          id="withdraw-account-name"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          className="h-11 rounded-xl"
          required
          minLength={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="withdraw-account-number">{t("wallet.accountNumber")}</Label>
        <Input
          id="withdraw-account-number"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          className="h-11 rounded-xl"
          required
          minLength={6}
        />
      </div>

      {method === "BANK" && (
        <div className="space-y-2">
          <Label htmlFor="withdraw-bank-name">{t("wallet.bankName")}</Label>
          <Input
            id="withdraw-bank-name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            className="h-11 rounded-xl"
            required
          />
        </div>
      )}

      {step === "code" && (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
          <p className="text-sm">
            {t("wd.codeSentTo")} <b>{sentTo}</b>
          </p>
          <Label htmlFor="withdraw-code">{t("wd.enterCode")}</Label>
          <Input
            id="withdraw-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-12 rounded-xl text-center text-xl font-bold tracking-[0.4em]"
            required
          />
          {devCode ? <p className="text-xs text-muted-foreground">Dev code: {devCode}</p> : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1 rounded-xl"
              disabled={busy || cooldown > 0}
              onClick={() => void sendCode()}
            >
              {cooldown > 0 ? t("wd.resend") + " (" + cooldown + "s)" : t("wd.resend")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-xl"
              onClick={() => {
                setStep("form");
                setCode("");
              }}
            >
              {t("wd.back")}
            </Button>
          </div>
        </div>
      )}

      <Button
        type="submit"
        className="h-12 w-full rounded-xl text-base font-bold"
        disabled={busy || !kycOk || !phoneOk || (step === "code" && code.length !== 6)}
      >
        {busy ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
        ) : null}
        {!SMS_REQUIRED || step === "code" ? t("wd.confirm") : t("wd.sendCode")}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function TxHistory() {
  const { t } = useI18n();
  const [type, setType] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", type, page],
    queryFn: () => api.get<TxPage>(`/api/wallet/transactions?type=${type}&page=${page}`),
    staleTime: 10_000,
  });

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => {
            setType("");
            setPage(1);
          }}
          aria-pressed={type === ""}
          className={cn(
            "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
            type === ""
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:border-primary/50"
          )}
        >
          {t("common.all")}
        </button>
        {TX_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setType(f);
              setPage(1);
            }}
            aria-pressed={type === f}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
              type === f
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:border-primary/50"
            )}
          >
            {t(`tx.${f}` as DictKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : (data?.transactions.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("wallet.noTransactions")}</p>
      ) : (
        <div className="space-y-2">
          {data!.transactions.map((tx) => {
            const credit = CREDIT_TYPES.has(tx.type);
            return (
              <Card key={tx.id} className="flex-row items-center gap-3 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t(`tx.${tx.type}` as DictKey)}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDateTime(tx.createdAt)}</p>
                  {tx.reference && (
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{tx.reference}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("text-sm font-bold tabular-nums", credit && "text-primary")}>
                    {credit ? "+" : "−"}
                    {formatETB(Math.abs(tx.amountCents))}
                  </span>
                  {txStatusBadge(tx.status, t)}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {data?.page ?? 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Wallet: balance card + overview / deposit / withdraw / history. */
export function WalletView() {
  const { t } = useI18n();
  const openAuth = useAppState((s) => s.openAuth);
  const { data: session, isLoading } = useSession();
  const user = session?.user ?? null;
  const [tab, setTab] = useState<WalletTab>("overview");

  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get<WalletResponse>("/api/wallet"),
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md pt-6">
        <Card className="items-center gap-3 rounded-xl py-10 text-center">
          <WalletIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("slip.needLogin")}</p>
          <Button className="mt-2 h-11 rounded-xl px-6" onClick={() => openAuth("login")}>
            {t("common.login")}
          </Button>
        </Card>
      </div>
    );
  }

  const wallet = walletQuery.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Balance card */}
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary to-primary/75 p-5 text-primary-foreground shadow-md">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gold/25 blur-2xl"
          aria-hidden
        />
        <p className="text-xs uppercase tracking-wide opacity-80">{t("wallet.balance")}</p>
        <p className="mt-1 text-3xl font-extrabold tabular-nums">
          {walletQuery.isLoading ? "…" : formatETB(wallet?.wallet?.balanceCents ?? 0)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-gold/25 px-3 py-1 text-xs font-semibold text-gold-foreground">
            {t("wallet.bonus")} {formatETB(wallet?.wallet?.bonusCents ?? 0)}
          </span>
          <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-semibold">
            {t("wallet.locked")} {formatETB(wallet?.wallet?.lockedCents ?? 0)}
          </span>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(v) => setTab(v as WalletTab)}>
        <TabsList className="h-11 w-full rounded-xl bg-muted p-1">
          <TabsTrigger value="overview" className="h-9 flex-1 rounded-lg text-xs sm:text-sm">
            {t("wallet.overview")}
          </TabsTrigger>
          <TabsTrigger value="deposit" className="h-9 flex-1 rounded-lg text-xs sm:text-sm">
            {t("wallet.deposit")}
          </TabsTrigger>
          <TabsTrigger value="withdraw" className="h-9 flex-1 rounded-lg text-xs sm:text-sm">
            {t("wallet.withdraw")}
          </TabsTrigger>
          <TabsTrigger value="history" className="h-9 flex-1 rounded-lg text-xs sm:text-sm">
            {t("wallet.history")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="gap-4 rounded-xl px-4 py-4">
            {[
              { label: t("wallet.balance"), value: formatETB(wallet?.wallet?.balanceCents ?? 0) },
              { label: t("wallet.bonus"), value: formatETB(wallet?.wallet?.bonusCents ?? 0) },
              { label: t("wallet.locked"), value: formatETB(wallet?.wallet?.lockedCents ?? 0) },
              { label: t("tx.DEPOSIT"), value: formatETB(wallet?.usage?.depositedTodayCents ?? 0) },
              { label: t("bets.stake"), value: formatETB(wallet?.usage?.stakedTodayCents ?? 0) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="text-sm font-bold tabular-nums">{row.value}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
              <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
              {t("profile.kyc")}:{" "}
              {user.kycStatus === "APPROVED"
                ? t("profile.kycApproved")
                : user.kycStatus === "PENDING"
                  ? t("profile.kycPending")
                  : user.kycStatus === "REJECTED"
                    ? t("profile.kycRejected")
                    : t("profile.kycNone")}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="deposit" className="mt-4">
          <Card className="rounded-xl px-4 py-4">
            {wallet ? <DepositForm wallet={wallet} /> : <Skeleton className="h-64 w-full rounded-xl" />}
          </Card>
        </TabsContent>

        <TabsContent value="withdraw" className="mt-4">
          <Card className="rounded-xl px-4 py-4">
            {wallet ? (
              <WithdrawForm wallet={wallet} onDone={() => setTab("history")} />
            ) : (
              <Skeleton className="h-64 w-full rounded-xl" />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <TxHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
