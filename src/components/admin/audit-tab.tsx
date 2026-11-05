"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorNote, PageNav, TableSkeleton, errMsg, useDebounced } from "@/components/admin/admin-ui";

interface AuditRow {
  id: string;
  actorId: string | null;
  actorPhone: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
}

type AuditPage = { logs: AuditRow[]; total: number; page: number; totalPages: number };

function prettyDetails(details: unknown): string {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function truncate(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function AuditTab() {
  const { t } = useI18n();
  const [actionInput, setActionInput] = useState("");
  const action = useDebounced(actionInput);
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["admin", "audit-logs", { action, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (action) params.set("action", action);
      return api.get<AuditPage>(`/api/admin/audit-logs?${params.toString()}`);
    },
  });

  const [detail, setDetail] = useState<AuditRow | null>(null);
  const rows = list.data?.logs ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={actionInput}
          onChange={(e) => {
            setActionInput(e.target.value);
            setPage(1);
          }}
          placeholder={t("admin.filterAction")}
          className="sm:max-w-xs font-mono text-xs"
        />
        <div className="sm:ml-auto">
          {list.data && (
            <PageNav page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
          )}
        </div>
      </div>

      {list.isError ? (
        <ErrorNote message={errMsg(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("admin.actor")}</TableHead>
                <TableHead>{t("admin.action")}</TableHead>
                <TableHead>{t("admin.target")}</TableHead>
                <TableHead>{t("admin.details")}</TableHead>
                <TableHead>{t("admin.ip")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={6} className="p-2">
                    <TableSkeleton rows={8} cols={5} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <EmptyState colSpan={6} />
              ) : (
                rows.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">{log.actorPhone ?? "system"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="max-w-44 truncate font-mono text-[10px] font-normal">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                      {log.entity ? `${log.entity}:${log.entityId?.slice(0, 10) ?? ""}` : "—"}
                    </TableCell>
                    <TableCell>
                      {log.details ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 font-mono text-[11px] text-muted-foreground"
                          onClick={() => setDetail(log)}
                        >
                          {t("admin.view")}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{log.ip ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              {detail?.action}
              <span className="font-sans text-xs font-normal text-muted-foreground">
                {detail ? formatDateTime(detail.createdAt) : ""}
              </span>
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            {detail ? truncate(prettyDetails(detail.details), 4000) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
