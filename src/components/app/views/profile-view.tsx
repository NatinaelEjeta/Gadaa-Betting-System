"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BadgeCheck,
  Copy,
  IdCard,
  Loader2,
  LogOut,
  Moon,
  ShieldCheck,
  ShieldAlert,
  Sun,
  Upload,
  UserCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import { useI18n, Language } from "@/lib/i18n";
import { useSession } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import type { DictKey } from "@/lib/i18n/en";
import { cn } from "@/lib/utils";

type KycDocType = "FAYDA" | "NATIONAL_ID" | "PASSPORT" | "DRIVING_LICENSE";
const KYC_DOC_TYPES: KycDocType[] = ["FAYDA", "NATIONAL_ID", "PASSPORT", "DRIVING_LICENSE"];
const EXCLUDE_DAYS = [1, 7, 30, 90, 365] as const;

interface KycDocument {
  id: string;
  docType: string;
  status: string;
  reviewerNote?: string | null;
  createdAt?: string;
}

/** Read an image file and downscale to ≤1000px JPEG dataURL (~<1.2MB). */
function fileToScaledDataUrl(file: File, max = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("bad image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// KYC card
// ---------------------------------------------------------------------------

function KycCard({ kycStatus }: { kycStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [docType, setDocType] = useState<KycDocType>("FAYDA");
  const [docNumber, setDocNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  const { data: kycData } = useQuery({
    queryKey: ["kyc"],
    queryFn: () => api.get<{ documents: KycDocument[] }>("/api/kyc"),
    staleTime: 60_000,
  });

  const latestDoc = kycData?.documents?.[0] ?? null;
  const showForm = kycStatus === "NONE" || kycStatus === "REJECTED";

  const pick = async (file: File | undefined, side: "front" | "back") => {
    if (!file) return;
    try {
      const dataUrl = await fileToScaledDataUrl(file);
      if (side === "front") setFrontImage(dataUrl);
      else setBackImage(dataUrl);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const submit = async () => {
    if (!frontImage) return;
    setBusy(true);
    try {
      await api.post("/api/kyc", {
        docType,
        docNumber,
        dateOfBirth,
        frontImage,
        ...(backImage ? { backImage } : {}),
      });
      toast.success(t("profile.kycSubmitted"));
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["kyc"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = () => {
    switch (kycStatus) {
      case "APPROVED":
        return <Badge className="bg-primary/15 text-primary">{t("profile.kycApproved")}</Badge>;
      case "PENDING":
        return <Badge variant="outline">{t("profile.kycPending")}</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">{t("profile.kycRejected")}</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">{t("profile.kycNone")}</Badge>;
    }
  };

  return (
    <Card className="gap-4 rounded-xl px-4 py-4">
      <div className="flex items-center gap-2">
        <IdCard className="h-5 w-5 text-primary" aria-hidden />
        <h3 className="font-bold">{t("profile.kyc")}</h3>
        {statusBadge()}
      </div>
      <p className="text-sm text-muted-foreground">{t("profile.kycDesc")}</p>

      {kycStatus === "REJECTED" && latestDoc?.reviewerNote && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertDescription className="text-sm">
            <span className="font-semibold">{t("profile.reviewerNote")}:</span> {latestDoc.reviewerNote}
          </AlertDescription>
        </Alert>
      )}

      {showForm ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="kyc-doc-type">{t("profile.docType")}</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as KycDocType)}>
                <SelectTrigger id="kyc-doc-type" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KYC_DOC_TYPES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`kyc.${d}` as DictKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="kyc-doc-number">{t("profile.docNumber")}</Label>
              <Input
                id="kyc-doc-number"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                className="h-11 rounded-xl"
                required
                minLength={4}
                maxLength={30}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="kyc-dob">{t("profile.dateOfBirth")}</Label>
            <Input
              id="kyc-dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="h-11 rounded-xl"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { side: "front" as const, label: t("profile.frontImage"), ref: frontInputRef, value: frontImage, required: true },
                { side: "back" as const, label: t("profile.backImage"), ref: backInputRef, value: backImage, required: false },
              ]
            ).map(({ side, label, ref, value, required }) => (
              <div key={side} className="space-y-2">
                <Label htmlFor={`kyc-${side}`}>{label}</Label>
                <button
                  type="button"
                  id={`kyc-${side}`}
                  onClick={() => ref.current?.click()}
                  className={cn(
                    "flex h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary/60",
                    value && "border-solid border-primary/60"
                  )}
                >
                  {value ? (
                    <img src={value} alt={label} className="h-full w-full rounded-lg object-cover" />
                  ) : (
                    <>
                      <Upload className="h-5 w-5" aria-hidden />
                      <span className="px-2 text-center">{t("common.tapToUpload")}</span>
                    </>
                  )}
                </button>
                <input
                  ref={ref}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label={label}
                  onChange={(e) => void pick(e.target.files?.[0], side)}
                />
              </div>
            ))}
          </div>

          <Button type="submit" className="h-11 w-full rounded-xl font-bold" disabled={busy || !frontImage || docNumber.length < 4 || !dateOfBirth}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("profile.submitKyc")}
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
          {kycStatus === "PENDING" ? t("profile.kycPending") : t("profile.kycApproved")}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Responsible gaming card
// ---------------------------------------------------------------------------

function ResponsibleGamingCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const limits = session?.user?.limits ?? null;
  const [depositLimit, setDepositLimit] = useState(
    limits?.dailyDepositLimitCents != null ? String(limits.dailyDepositLimitCents / 100) : ""
  );
  const [stakeLimit, setStakeLimit] = useState(
    limits?.dailyStakeLimitCents != null ? String(limits.dailyStakeLimitCents / 100) : ""
  );
  const [lossLimit, setLossLimit] = useState(
    limits?.lossLimitCents != null ? String(limits.lossLimitCents / 100) : ""
  );
  const [coolingOffHours, setCoolingOffHours] = useState("");
  const [busy, setBusy] = useState(false);

  const coolingOffUntil = limits?.coolingOffUntil ? new Date(limits.coolingOffUntil) : null;
  const excludedNow = coolingOffUntil != null && coolingOffUntil.getTime() > Date.now();

  const toCentsOrNull = (v: string): number | null => {
    const s = v.trim();
    if (s === "") return null;
    const n = Number.parseFloat(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };

  const saveLimits = async () => {
    setBusy(true);
    try {
      await api.put("/api/profile/limits", {
        dailyDepositLimitCents: toCentsOrNull(depositLimit),
        dailyStakeLimitCents: toCentsOrNull(stakeLimit),
        lossLimitCents: toCentsOrNull(lossLimit),
        ...(coolingOffHours.trim() !== "" ? { coolingOffHours: Number.parseInt(coolingOffHours, 10) } : {}),
      });
      toast.success(t("profile.limitsSaved"));
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const selfExclude = async (days: number) => {
    try {
      await api.post("/api/profile/limits", { days });
      toast.warning(t("profile.excluded"));
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    }
  };

  return (
    <Card className="gap-4 rounded-xl px-4 py-4">
      <h3 className="font-bold">{t("profile.responsibleGaming")}</h3>

      {excludedNow && coolingOffUntil && (
        <Alert className="border-gold/50 bg-gold/10">
          <ShieldAlert className="h-4 w-4 text-gold-foreground" aria-hidden />
          <AlertDescription className="text-sm">
            <span className="font-semibold">{t("profile.excluded")}</span>{" "}
            — {t("profile.excludedUntil", { date: coolingOffUntil.toLocaleDateString() })}
          </AlertDescription>
        </Alert>
      )}

      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void saveLimits();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="limit-deposit">{t("profile.depositLimit")}</Label>
          <Input
            id="limit-deposit"
            inputMode="decimal"
            value={depositLimit}
            onChange={(e) => setDepositLimit(e.target.value)}
            placeholder="0"
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="limit-stake">{t("profile.stakeLimit")}</Label>
          <Input
            id="limit-stake"
            inputMode="decimal"
            value={stakeLimit}
            onChange={(e) => setStakeLimit(e.target.value)}
            placeholder="0"
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="limit-loss">{t("profile.lossLimit")}</Label>
          <Input
            id="limit-loss"
            inputMode="decimal"
            value={lossLimit}
            onChange={(e) => setLossLimit(e.target.value)}
            placeholder="0"
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="limit-cooling">{t("profile.coolingOff")}</Label>
          <Input
            id="limit-cooling"
            inputMode="numeric"
            value={coolingOffHours}
            onChange={(e) => setCoolingOffHours(e.target.value)}
            placeholder="1–720"
            className="h-11 rounded-xl"
          />
        </div>
        <Button type="submit" className="h-11 rounded-xl font-bold sm:col-span-2" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("common.save")}
        </Button>
      </form>

      <Separator />

      <div>
        <p className="text-sm font-semibold">{t("profile.selfExclude")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("profile.selfExcludeDesc")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXCLUDE_DAYS.map((d) => (
            <AlertDialog key={d}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="h-10 flex-1 rounded-xl tabular-nums">
                  {d}
                  <span className="ml-1 text-[10px] text-muted-foreground">{t("profile.days")}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-xs rounded-xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("profile.selfExcludeTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("profile.selfExcludeConfirm", { days: d })}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction className="h-11" onClick={() => void selfExclude(d)}>
                    {t("common.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Profile view
// ---------------------------------------------------------------------------

/** Profile: account info, KYC upload, responsible gaming, preferences. */
export function ProfileView() {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const openAuth = useAppState((s) => s.openAuth);
  const navigate = useAppState((s) => s.navigate);
  const queryClient = useQueryClient();
  const { data: session, isLoading } = useSession();
  const user = session?.user ?? null;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md pt-6">
        <Card className="items-center gap-3 rounded-xl py-10 text-center">
          <UserCircle2 className="h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("bets.loginPrompt")}</p>
          <Button className="mt-2 h-11 rounded-xl px-6" onClick={() => openAuth("login")}>
            {t("common.login")}
          </Button>
        </Card>
      </div>
    );
  }

  const copyReferral = async () => {
    try {
      await navigator.clipboard.writeText(user.referralCode);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const changeLanguage = (l: Language) => {
    setLanguage(l);
    void api.put("/api/profile", { language: l }).catch(() => undefined);
  };

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    await queryClient.invalidateQueries();
    navigate("home");
    toast.success(t("common.logout"));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-extrabold tracking-tight">{t("profile.title")}</h1>

      {/* Account card */}
      <Card className="gap-4 rounded-xl px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-primary-foreground">
            {user.fullName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{user.fullName}</p>
            <p className="truncate text-sm text-muted-foreground">{user.phone}</p>
            <p className="text-xs text-muted-foreground">
              {t("profile.memberSince")} {new Date(user.createdAt).toLocaleDateString()}
            </p>
          </div>
          <span className="ml-auto">
            {user.phoneVerified ? (
              <Badge className="bg-primary/15 text-primary">
                <BadgeCheck className="h-3 w-3" aria-hidden /> {t("profile.phoneVerified")}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t("common.pending")}
              </Badge>
            )}
          </span>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("profile.referralCode")}</p>
            <p className="font-mono text-lg font-bold tracking-wider">{user.referralCode}</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl"
            onClick={() => void copyReferral()}
            aria-label={t("common.copy")}
          >
            <Copy className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </Card>

      <KycCard kycStatus={user.kycStatus} />

      <ResponsibleGamingCard />

      {/* Preferences */}
      <Card className="gap-4 rounded-xl px-4 py-4">
        <h3 className="font-bold">{t("profile.settings")}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pref-language">{t("common.language")}</Label>
            <Select value={language} onValueChange={(v) => changeLanguage(v as Language)}>
              <SelectTrigger id="pref-language" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">EN — English</SelectItem>
                <SelectItem value="am">አማ — አማርኛ</SelectItem>
                <SelectItem value="om">OM — Afaan Oromo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pref-theme">{t("common.theme")}</Label>
            <div id="pref-theme" className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={theme !== "dark" ? "default" : "outline"}
                className="h-11 rounded-xl"
                onClick={() => setTheme("light")}
                aria-pressed={theme !== "dark"}
              >
                <Sun className="mr-1.5 h-4 w-4" aria-hidden /> {t("common.theme")}
              </Button>
              <Button
                type="button"
                variant={theme === "dark" ? "default" : "outline"}
                className="h-11 rounded-xl"
                onClick={() => setTheme("dark")}
                aria-pressed={theme === "dark"}
              >
                <Moon className="mr-1.5 h-4 w-4" aria-hidden /> {t("common.theme")}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Button variant="outline" className="h-12 w-full rounded-xl text-destructive" onClick={() => void logout()}>
        <LogOut className="mr-2 h-4 w-4" aria-hidden />
        {t("common.logout")}
      </Button>
    </div>
  );
}
