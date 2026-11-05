"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GadaaLogo } from "@/components/app/gadaa-logo";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useAppState } from "@/stores/app-state";

type Mode = "login" | "register" | "forgot" | "reset" | "otp";

const minCls = "h-11 rounded-xl"; // 44px touch target

/** Auth: login / register / forgot / reset / OTP — sandbox shows devOtp. */
export function AuthView() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useAppState((s) => s.navigate);
  const authMode = useAppState((s) => s.authMode);

  const [mode, setMode] = useState<Mode>(authMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [code, setCode] = useState("");

  // keep in sync when openAuth() is used elsewhere in the app
  useEffect(() => {
    setMode(authMode);
  }, [authMode]);

  const reset = () => {
    setError(null);
    setDevOtp(null);
    setCode("");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : t("common.error");
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = () =>
    run(async () => {
      await api.post("/api/auth/login", { phone, password });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success(t("auth.welcomeBack"));
      navigate("home");
    });

  const submitRegister = () => {
    if (password !== confirmPassword) {
      setError(t("auth.confirmPassword"));
      toast.error(t("auth.confirmPassword"));
      return;
    }
    void run(async () => {
      const res = await api.post<{ devOtp?: string }>("/api/auth/register", {
        fullName,
        phone,
        password,
        dateOfBirth,
        ...(referralCode.trim() !== "" ? { referralCode: referralCode.trim() } : {}),
      });
      setDevOtp(res.devOtp ?? null);
      setCode(res.devOtp ?? "");
      toast.success(t("auth.accountCreated"));
      setMode("otp");
    });
  };

  const submitOtp = () =>
    run(async () => {
      await api.post("/api/auth/otp/verify", { phone, code });
      toast.success(t("auth.verified"));
      reset();
      setPassword("");
      setMode("login");
    });

  const submitForgot = () =>
    run(async () => {
      const res = await api.post<{ devOtp?: string }>("/api/auth/forgot-password", { phone });
      setDevOtp(res.devOtp ?? null);
      setCode(res.devOtp ?? "");
      setMode("reset");
    });

  const submitReset = () =>
    run(async () => {
      await api.post("/api/auth/reset-password", { phone, code, newPassword: password });
      toast.success(t("auth.resetSuccess"));
      reset();
      setPassword("");
      setMode("login");
    });

  const title: string =
    mode === "login"
      ? t("auth.welcomeBack")
      : mode === "register"
        ? t("auth.createAccount")
        : mode === "otp"
          ? t("auth.otpTitle")
          : mode === "forgot"
            ? t("auth.forgotPassword")
            : t("auth.newPassword");

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-6">
      <Card className="w-full gap-5 rounded-xl px-5 py-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <GadaaLogo size={44} />
          <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
        </div>

        {devOtp && (mode === "otp" || mode === "reset") && (
          <Alert className="border-gold/50 bg-gold/10">
            <AlertDescription className="text-sm font-medium text-gold-foreground">
              {t("auth.sandboxCode", { code: devOtp })}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* LOGIN */}
        {mode === "login" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitLogin();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="login-phone">{t("auth.phone")}</Label>
              <Input
                id="login-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("auth.phonePlaceholder")}
                className={minCls}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">{t("auth.password")}</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={minCls}
                required
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={busy}>
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : null}
              {t("common.login")}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-primary hover:underline" onClick={() => { reset(); setMode("forgot"); }}>
                {t("auth.forgotPassword")}
              </button>
              <button type="button" className="text-primary hover:underline" onClick={() => { reset(); setMode("register"); }}>
                {t("common.register")}
              </button>
            </div>
          </form>
        )}

        {/* REGISTER */}
        {mode === "register" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitRegister();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="reg-name">{t("auth.fullName")}</Label>
              <Input
                id="reg-name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={minCls}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-phone">{t("auth.phone")}</Label>
              <Input
                id="reg-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("auth.phonePlaceholder")}
                className={minCls}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reg-password">{t("auth.password")}</Label>
                <Input
                  id="reg-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={minCls}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-confirm">{t("auth.confirmPassword")}</Label>
                <Input
                  id="reg-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={minCls}
                  required
                  minLength={8}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-dob">{t("auth.dob")}</Label>
              <Input
                id="reg-dob"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={minCls}
                required
              />
              <p className="text-xs text-muted-foreground">{t("footer.responsible")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-referral">{t("auth.referralCode")}</Label>
              <Input
                id="reg-referral"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                className={minCls}
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={busy}>
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : null}
              {t("common.register")}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t("auth.haveAccount")}{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => { reset(); setMode("login"); }}>
                {t("common.login")}
              </button>
            </p>
          </form>
        )}

        {/* OTP VERIFY */}
        {mode === "otp" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitOtp();
            }}
          >
            <p className="text-sm text-muted-foreground">{t("auth.otpSent")}</p>
            <div className="space-y-2">
              <Label htmlFor="otp-code">{t("auth.enterCode")}</Label>
              <Input
                id="otp-code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${minCls} text-center text-lg font-bold tracking-[0.4em]`}
                required
                minLength={4}
                maxLength={8}
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={busy}>
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : null}
              {t("auth.verifyOtp")}
            </Button>
            <button type="button" className="block w-full text-center text-sm text-primary hover:underline" onClick={() => { reset(); setMode("login"); }}>
              {t("auth.backToLogin")}
            </button>
          </form>
        )}

        {/* FORGOT */}
        {mode === "forgot" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitForgot();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="forgot-phone">{t("auth.phone")}</Label>
              <Input
                id="forgot-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("auth.phonePlaceholder")}
                className={minCls}
                required
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={busy}>
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : null}
              {t("auth.sendCode")}
            </Button>
            <button type="button" className="block w-full text-center text-sm text-primary hover:underline" onClick={() => { reset(); setMode("login"); }}>
              {t("auth.backToLogin")}
            </button>
          </form>
        )}

        {/* RESET */}
        {mode === "reset" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitReset();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="reset-phone">{t("auth.phone")}</Label>
              <Input id="reset-phone" value={phone} readOnly className={`${minCls} bg-muted`} aria-readonly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-code">{t("auth.enterCode")}</Label>
              <Input
                id="reset-code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${minCls} text-center text-lg font-bold tracking-[0.4em]`}
                required
                minLength={4}
                maxLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password">{t("auth.newPassword")}</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={minCls}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={busy}>
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : null}
              {t("common.confirm")}
            </Button>
            <button type="button" className="block w-full text-center text-sm text-primary hover:underline" onClick={() => { reset(); setMode("login"); }}>
              {t("auth.backToLogin")}
            </button>
          </form>
        )}
      </Card>

      <p className="mt-4 text-center text-xs text-muted-foreground">{t("footer.responsible")}</p>
    </div>
  );
}
