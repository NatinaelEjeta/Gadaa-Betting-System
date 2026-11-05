"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNote, InlineSpinner, errMsg } from "@/components/admin/admin-ui";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors PlatformSettings from the API (kept local to avoid server-only imports). */
interface PlatformSettings {
  minDepositCents: number;
  maxDepositCents: number;
  minWithdrawalCents: number;
  maxWithdrawalCents: number;
  withdrawalFeeBps: number;
  minStakeCents: number;
  maxStakeCents: number;
  maxPotentialWinCents: number;
  maxLegs: number;
  liveBetDelaySeconds: number;
  cashoutDiscount: number;
  welcomeBonusPercent: number;
  welcomeBonusMaxCents: number;
  referralBonusCents: number;
  livePollSeconds: number;
  oddsSyncSeconds: number;
  fixturesSyncMinutes: number;
  marketSuspendSeconds: number;
  provider: string;
}

type Group = "payments" | "betting" | "bonuses" | "live";
type SettingsPage = { settings: PlatformSettings; defaults: PlatformSettings };

interface FieldDef {
  key: keyof PlatformSettings;
  group: Group;
  kind: "etb" | "int" | "float" | "provider";
  step?: string;
  min?: string;
}

/** "minDepositCents" → "Min deposit" (+ ETB suffix for money fields). */
function fieldLabel(key: string, kind: FieldDef["kind"]): string {
  const spaced = key.replace(/Cents$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  const label = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return kind === "etb" ? `${label} (ETB)` : label;
}

const FIELDS: FieldDef[] = [
  { key: "minDepositCents", group: "payments", kind: "etb" },
  { key: "maxDepositCents", group: "payments", kind: "etb" },
  { key: "minWithdrawalCents", group: "payments", kind: "etb" },
  { key: "maxWithdrawalCents", group: "payments", kind: "etb" },
  { key: "withdrawalFeeBps", group: "payments", kind: "int", min: "0" },
  { key: "minStakeCents", group: "betting", kind: "etb" },
  { key: "maxStakeCents", group: "betting", kind: "etb" },
  { key: "maxPotentialWinCents", group: "betting", kind: "etb" },
  { key: "maxLegs", group: "betting", kind: "int", min: "1" },
  { key: "liveBetDelaySeconds", group: "betting", kind: "int", min: "0" },
  { key: "cashoutDiscount", group: "betting", kind: "float", step: "0.01", min: "0" },
  { key: "welcomeBonusPercent", group: "bonuses", kind: "int", min: "0" },
  { key: "welcomeBonusMaxCents", group: "bonuses", kind: "etb" },
  { key: "referralBonusCents", group: "bonuses", kind: "etb" },
  { key: "livePollSeconds", group: "live", kind: "int", min: "1" },
  { key: "oddsSyncSeconds", group: "live", kind: "int", min: "1" },
  { key: "fixturesSyncMinutes", group: "live", kind: "int", min: "1" },
  { key: "marketSuspendSeconds", group: "live", kind: "int", min: "0" },
  { key: "provider", group: "live", kind: "provider" },
];

const GROUP_ORDER: Group[] = ["payments", "betting", "bonuses", "live"];

type FormState = Record<string, string>;

function toForm(settings: PlatformSettings): FormState {
  const form: FormState = {};
  for (const f of FIELDS) {
    if (f.kind === "etb") {
      form[f.key] = String(Number(settings[f.key]) / 100);
    } else {
      form[f.key] = String(settings[f.key]);
    }
  }
  return form;
}

function toPayload(form: FormState): Record<string, number | string> {
  const payload: Record<string, number | string> = {};
  for (const f of FIELDS) {
    const raw = form[f.key];
    if (raw === undefined || raw.trim() === "") continue;
    if (f.kind === "etb") {
      const cents = Math.round(Number(raw) * 100);
      if (Number.isFinite(cents)) payload[f.key] = cents;
    } else if (f.kind === "int") {
      const n = Math.round(Number(raw));
      if (Number.isFinite(n)) payload[f.key] = n;
    } else if (f.kind === "float") {
      const n = Number(raw);
      if (Number.isFinite(n)) payload[f.key] = n;
    } else {
      payload[f.key] = raw;
    }
  }
  return payload;
}

export function SettingsTab() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get<SettingsPage>("/api/admin/settings"),
  });

  const [form, setForm] = useState<FormState>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data?.settings) setForm(toForm(settings.data.settings));
  }, [settings.data]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      await api.put("/api/admin/settings", toPayload(form));
      toast.success(t("admin.settingsSaved"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (settings.isError) {
    return <ErrorNote message={errMsg(settings.error)} onRetry={() => void settings.refetch()} />;
  }

  if (settings.isLoading || Object.keys(form).length === 0) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 rounded-lg" />
        ))}
      </div>
    );
  }

  const defaults = settings.data?.defaults;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("admin.etbHint")}</p>

      <div className="grid gap-4 xl:grid-cols-2">
        {GROUP_ORDER.map((group) => (
          <Card key={group}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t(
                  group === "payments"
                    ? "admin.paymentsGroup"
                    : group === "betting"
                      ? "admin.bettingGroup"
                      : group === "bonuses"
                        ? "admin.bonusesGroup"
                        : "admin.liveDataGroup"
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {FIELDS.filter((f) => f.group === group).map((f) => (
                <div key={f.key} className="grid gap-1.5">
                  {f.kind === "provider" ? (
                    <>
                      <span className="text-xs font-medium text-muted-foreground">{t("admin.provider")}</span>
                      <Select value={form.provider ?? "mock"} onValueChange={(v) => set("provider", v)}>
                        <SelectTrigger className="w-full" aria-label={t("admin.provider")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mock">mock</SelectItem>
                          <SelectItem value="api-football">api-football</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {fieldLabel(f.key, f.kind)}
                        </span>
                        {defaults && form[f.key] !== String(
                          f.kind === "etb" ? Number(defaults[f.key]) / 100 : defaults[f.key]
                        ) && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-muted-foreground">
                            ↺
                          </Badge>
                        )}
                      </div>
                      <Input
                        value={form[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        inputMode="decimal"
                        step={f.step}
                        min={f.min}
                        className="tabular-nums"
                      />
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <InlineSpinner /> : null}
          {t("common.save")}
        </Button>
        {defaults && (
          <Button variant="outline" disabled={saving} onClick={() => setForm(toForm(defaults))}>
            {t("admin.resetDefaults")}
          </Button>
        )}
      </div>
    </div>
  );
}
