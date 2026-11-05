"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { formatETB, timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardsSkeleton, ErrorNote, InlineSpinner, can, errMsg } from "@/components/admin/admin-ui";

interface BonusRow {
  id: string;
  name: string;
  type: string;
  percent: number | null;
  maxAmountCents: number | null;
  fixedCents: number | null;
  minDepositCents: number | null;
  minOdds: number | null;
  active: boolean;
  description: string | null;
  createdAt: string;
  grantsCount: number;
}

interface GrantRow {
  id: string;
  amountCents: number;
  status: string;
  reason: string | null;
  createdAt: string;
  user: { id: string; phone: string; fullName: string };
}

type BonusesPage = { bonuses: BonusRow[]; grants: GrantRow[] };

const BONUS_TYPES = ["WELCOME", "REFERRAL", "DEPOSIT", "MANUAL"] as const;

function bonusValue(b: BonusRow): string {
  if (b.percent !== null) {
    const max = b.maxAmountCents ? ` · ${formatETB(b.maxAmountCents)}` : "";
    return `${b.percent}%${max}`;
  }
  if (b.fixedCents !== null) return formatETB(b.fixedCents);
  return "—";
}

export function BonusesTab({ role }: { role: string | null }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const canManage = can(role, ["ADMIN", "SUPER_ADMIN"]);

  const list = useQuery({
    queryKey: ["admin", "bonuses"],
    queryFn: () => api.get<BonusesPage>("/api/admin/bonuses"),
  });

  // create bonus dialog state (ETB inputs converted to cents on submit)
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "DEPOSIT" as (typeof BONUS_TYPES)[number],
    percent: "",
    maxAmountEtb: "",
    fixedEtb: "",
    minDepositEtb: "",
    active: true,
    description: "",
  });

  // grant form state
  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);

  const etbToCents = (v: string): number | undefined => {
    if (v.trim() === "") return undefined;
    const n = Math.round(Number(v) * 100);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  async function createBonus() {
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        active: form.active,
      };
      const percent = form.percent.trim() === "" ? undefined : Math.round(Number(form.percent));
      if (percent !== undefined && Number.isFinite(percent)) body.percent = percent;
      const max = etbToCents(form.maxAmountEtb);
      if (max !== undefined) body.maxAmountCents = max;
      const fixed = etbToCents(form.fixedEtb);
      if (fixed !== undefined) body.fixedCents = fixed;
      const minDep = etbToCents(form.minDepositEtb);
      if (minDep !== undefined) body.minDepositCents = minDep;
      if (form.description.trim()) body.description = form.description.trim();

      await api.post("/api/admin/bonuses", body);
      toast.success(t("admin.bonusCreated"));
      setCreateOpen(false);
      setForm({ name: "", type: "DEPOSIT", percent: "", maxAmountEtb: "", fixedEtb: "", minDepositEtb: "", active: true, description: "" });
      void queryClient.invalidateQueries({ queryKey: ["admin", "bonuses"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreating(false);
    }
  }

  async function grantBonus() {
    setGranting(true);
    try {
      const cents = Math.round(Number(grantAmount) * 100);
      await api.post("/api/admin/bonuses/grant", {
        userId: grantUserId.trim(),
        amountCents: cents,
        reason: grantReason.trim() || undefined,
      });
      toast.success(t("admin.bonusGranted"));
      setGrantUserId("");
      setGrantAmount("");
      setGrantReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "bonuses"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setGranting(false);
    }
  }

  const grantValid = grantUserId.trim().length > 0 && Number(grantAmount) > 0;

  return (
    <div className="space-y-4">
      {list.isError ? (
        <ErrorNote message={errMsg(list.error)} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <CardsSkeleton count={3} />
      ) : (
        <>
          {/* bonus cards */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(list.data?.bonuses ?? []).map((b) => (
              <Card key={b.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate text-sm font-semibold">{b.name}</CardTitle>
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      {b.type}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("admin.bonusValue")}</span>
                    <span className="font-semibold tabular-nums">{bonusValue(b)}</span>
                  </div>
                  {b.minDepositCents ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("admin.minDepositEtb")}</span>
                      <span className="tabular-nums">{formatETB(b.minDepositCents)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("admin.grants")}</span>
                    <span className="tabular-nums">{b.grantsCount}</span>
                  </div>
                  {b.description ? (
                    <p className="text-muted-foreground">{b.description}</p>
                  ) : null}
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("admin.active")}</span>
                    <Switch checked={b.active} disabled aria-label={t("admin.active")} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {(list.data?.bonuses ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("admin.noResults")}</p>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {/* grant bonus */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("admin.grantBonus")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="grant-user">{t("admin.grantUserId")}</Label>
                  <Input
                    id="grant-user"
                    value={grantUserId}
                    onChange={(e) => setGrantUserId(e.target.value)}
                    placeholder="cm…"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="grant-amount">{t("admin.grantAmountEtb")}</Label>
                  <Input
                    id="grant-amount"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="grant-reason">{t("admin.grantReason")}</Label>
                  <Input
                    id="grant-reason"
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!canManage || granting || !grantValid}
                  onClick={() => void grantBonus()}
                >
                  {granting ? <InlineSpinner /> : null}
                  {t("admin.grant")}
                </Button>
              </CardContent>
            </Card>

            {/* recent grants */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("admin.recentGrants")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {(list.data?.grants ?? []).map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{g.user.fullName}</p>
                        <p className="truncate text-muted-foreground">
                          {g.user.phone}
                          {g.reason ? ` · ${g.reason}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums text-primary">{formatETB(g.amountCents)}</p>
                        <p className="text-muted-foreground">{timeAgo(g.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                  {(list.data?.grants ?? []).length === 0 && (
                    <p className="py-6 text-center text-muted-foreground">{t("admin.noResults")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {canManage && (
        <Button className="self-start" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("admin.createBonus")}
        </Button>
      )}

      {/* create bonus dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.createBonus")}</DialogTitle>
            <DialogDescription>{t("admin.etbHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bonus-name">{t("admin.bonusName")}</Label>
              <Input
                id="bonus-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={60}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bonus-type">{t("admin.bonusType")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as (typeof BONUS_TYPES)[number] }))}>
                <SelectTrigger id="bonus-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BONUS_TYPES.map((bt) => (
                    <SelectItem key={bt} value={bt}>
                      {bt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="bonus-percent">{t("admin.percent")}</Label>
                <Input
                  id="bonus-percent"
                  value={form.percent}
                  onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))}
                  inputMode="numeric"
                  placeholder="100"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bonus-max">{t("admin.maxAmountEtb")}</Label>
                <Input
                  id="bonus-max"
                  value={form.maxAmountEtb}
                  onChange={(e) => setForm((f) => ({ ...f, maxAmountEtb: e.target.value }))}
                  inputMode="decimal"
                  placeholder="250"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bonus-fixed">{t("admin.fixedEtb")}</Label>
                <Input
                  id="bonus-fixed"
                  value={form.fixedEtb}
                  onChange={(e) => setForm((f) => ({ ...f, fixedEtb: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bonus-mindep">{t("admin.minDepositEtb")}</Label>
                <Input
                  id="bonus-mindep"
                  value={form.minDepositEtb}
                  onChange={(e) => setForm((f) => ({ ...f, minDepositEtb: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bonus-desc">{t("admin.description")}</Label>
              <Input
                id="bonus-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={300}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="bonus-active">{t("admin.active")}</Label>
              <Switch
                id="bonus-active"
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={creating || form.name.trim().length < 2} onClick={() => void createBonus()}>
              {creating ? <InlineSpinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
