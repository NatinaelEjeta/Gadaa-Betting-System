"use client";

import { useMemo, useState } from "react";
import { LayoutDashboard, ShieldAlert, Undo2, Users, FileCheck2, Banknote, CalendarDays, Receipt, Gift, ScrollText, Settings2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ADMIN_ROLES, can } from "@/components/admin/admin-ui";
import { DashboardTab } from "@/components/admin/dashboard-tab";
import { UsersTab } from "@/components/admin/users-tab";
import { KycTab } from "@/components/admin/kyc-tab";
import { WithdrawalsTab } from "@/components/admin/withdrawals-tab";
import { EventsTab } from "@/components/admin/events-tab";
import { BetsTab } from "@/components/admin/bets-tab";
import { BonusesTab } from "@/components/admin/bonuses-tab";
import { AuditTab } from "@/components/admin/audit-tab";
import { SettingsTab } from "@/components/admin/settings-tab";

type TabId =
  | "dashboard"
  | "users"
  | "kyc"
  | "withdrawals"
  | "events"
  | "bets"
  | "bonuses"
  | "audit"
  | "settings";

interface TabDef {
  id: TabId;
  labelKey: "admin.dashboard" | "admin.users" | "admin.kyc" | "admin.withdrawals" | "admin.events" | "admin.bets" | "admin.bonuses" | "admin.audit" | "admin.settings";
  icon: typeof LayoutDashboard;
  roles: readonly string[];
}

function AccessDenied() {
  const { t } = useI18n();
  const navigate = useAppState((s) => s.navigate);
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm border-destructive/30">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">{t("admin.accessDenied")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.accessDeniedDesc")}</p>
          <Button variant="outline" className="mt-2" onClick={() => navigate("home")}>
            <Undo2 className="h-4 w-4" />
            {t("admin.backHome")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

export function AdminView() {
  const { t } = useI18n();
  const { data, isLoading } = useSession();
  const role = data?.user?.role ?? null;

  const tabs = useMemo<TabDef[]>(() => {
    const all: TabDef[] = [
      { id: "dashboard", labelKey: "admin.dashboard", icon: LayoutDashboard, roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
      { id: "users", labelKey: "admin.users", icon: Users, roles: ADMIN_ROLES },
      { id: "kyc", labelKey: "admin.kyc", icon: FileCheck2, roles: ["SUPPORT", "ADMIN", "SUPER_ADMIN"] },
      { id: "withdrawals", labelKey: "admin.withdrawals", icon: Banknote, roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
      { id: "events", labelKey: "admin.events", icon: CalendarDays, roles: ADMIN_ROLES },
      { id: "bets", labelKey: "admin.bets", icon: Receipt, roles: ADMIN_ROLES },
      { id: "bonuses", labelKey: "admin.bonuses", icon: Gift, roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
      { id: "audit", labelKey: "admin.audit", icon: ScrollText, roles: ADMIN_ROLES },
      { id: "settings", labelKey: "admin.settings", icon: Settings2, roles: ["ADMIN", "SUPER_ADMIN"] },
    ];
    return all.filter((tab) => can(role, tab.roles));
  }, [role]);

  const [tab, setTab] = useState<TabId>("dashboard");

  // fall back to the first allowed tab if the current one is not permitted
  const active = tabs.find((x) => x.id === tab) ?? tabs[0];

  if (isLoading) return <ShellSkeleton />;
  if (!data?.user || !can(role, ADMIN_ROLES) || !active) return <AccessDenied />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">{t("admin.title")}</h1>
        <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {data.user.role}
        </span>
      </div>

      {/* horizontally scrollable tab bar */}
      <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label={t("admin.title")}>
        <div className="flex w-max min-w-full gap-1 rounded-lg border bg-card p-1">
          {tabs.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={active.id === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active.id === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {active.id === "dashboard" && <DashboardTab />}
      {active.id === "users" && <UsersTab />}
      {active.id === "kyc" && <KycTab />}
      {active.id === "withdrawals" && <WithdrawalsTab />}
      {active.id === "events" && <EventsTab role={role} />}
      {active.id === "bets" && <BetsTab role={role} />}
      {active.id === "bonuses" && <BonusesTab role={role} />}
      {active.id === "audit" && <AuditTab />}
      {active.id === "settings" && <SettingsTab />}
    </div>
  );
}
