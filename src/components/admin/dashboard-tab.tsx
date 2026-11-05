"use client";

import { useSyncExternalStore, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api-client";
import { ReportDTO } from "@/lib/serialize";
import { formatETB } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, ErrorNote, errMsg } from "@/components/admin/admin-ui";

const RANGES = ["7", "28", "180"] as const;
type Range = (typeof RANGES)[number];

/** Hydration-safe "has mounted" flag (charts measure client-side only). */
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

const AXIS_STYLE = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
const TOOLTIP_STYLE = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--card-foreground)",
} as const;

export function DashboardTab() {
  const { t } = useI18n();
  const [range, setRange] = useState<Range>("7");
  const mounted = useMounted();

  const report = useQuery({
    queryKey: ["admin", "reports", range],
    queryFn: () => api.get<ReportDTO>(`/api/admin/reports?range=${range}`),
  });

  const days = report.data?.days ?? [];
  const totals = report.data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("admin.financialReport")}</h2>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t("admin.last7")}</SelectItem>
            <SelectItem value="28">{t("admin.last28")}</SelectItem>
            <SelectItem value="180">{t("admin.last180")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {report.isError ? (
        <ErrorNote message={errMsg(report.error)} onRetry={() => void report.refetch()} />
      ) : (
        <>
          {/* primary KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("admin.deposits")} value={formatETB(totals?.depositsCents)} loading={report.isLoading} />
            <StatCard label={t("admin.stakes")} value={formatETB(totals?.stakesCents)} loading={report.isLoading} />
            <StatCard label={t("admin.payouts")} value={formatETB(totals?.payoutsCents)} loading={report.isLoading} />
            <StatCard
              label={t("admin.ggr")}
              value={formatETB(totals?.ggrCents)}
              hint={totals ? t("admin.betsCount") + ": " + totals.betsCount.toLocaleString() : undefined}
              loading={report.isLoading}
            />
          </div>

          {/* secondary KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("admin.totalUsers")} value={(totals?.usersCount ?? 0).toLocaleString()} loading={report.isLoading} />
            <StatCard label={t("admin.openBets")} value={(totals?.openBetsCount ?? 0).toLocaleString()} loading={report.isLoading} />
            <StatCard label={t("admin.pendingWithdrawals")} value={formatETB(totals?.pendingWithdrawalsCents)} loading={report.isLoading} />
            <StatCard label={t("admin.pendingKyc")} value={(totals?.pendingKycCount ?? 0).toLocaleString()} loading={report.isLoading} />
          </div>

          {/* charts */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("admin.depositsVsPayouts")}</CardTitle>
              </CardHeader>
              <CardContent>
                {mounted && (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="payGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={AXIS_STYLE}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={28}
                        tickFormatter={(v: string) => v.slice(5)}
                      />
                      <YAxis
                        tick={AXIS_STYLE}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v: number) => (v / 100).toFixed(0)}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value) => formatETB(Number(value))}
                        labelFormatter={(label: string) => label}
                      />
                      <Area
                        type="monotone"
                        dataKey="depositsCents"
                        name={t("admin.deposits")}
                        stroke="var(--chart-1)"
                        strokeWidth={2}
                        fill="url(#depGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="payoutsCents"
                        name={t("admin.payouts")}
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        fill="url(#payGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("admin.dailyGgr")}</CardTitle>
              </CardHeader>
              <CardContent>
                {mounted && (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={AXIS_STYLE}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={28}
                        tickFormatter={(v: string) => v.slice(5)}
                      />
                      <YAxis
                        tick={AXIS_STYLE}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v: number) => (v / 100).toFixed(0)}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value) => formatETB(Number(value))}
                        cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                      />
                      <Bar dataKey="ggrCents" name={t("admin.ggr")} fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
