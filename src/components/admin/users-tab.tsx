"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { AdminUserRowDTO } from "@/lib/serialize";
import { formatDateTime, formatETB } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/hooks/use-data";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  ErrorNote,
  PageNav,
  StatusBadge,
  TableSkeleton,
  can,
  errMsg,
  useDebounced,
} from "@/components/admin/admin-ui";

type UsersPage = { users: AdminUserRowDTO[]; page: number; total: number; totalPages: number };
type StatusFilter = "ALL" | "ACTIVE" | "SUSPENDED" | "BANNED";
const ROLES = ["USER", "SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"] as const;

export function UsersTab() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const session = useSession();
  const myRole = session.data?.user?.role ?? null;
  const isSuperAdmin = can(myRole, ["SUPER_ADMIN"]);

  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["admin", "users", { q, status, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      if (status !== "ALL") params.set("status", status);
      return api.get<UsersPage>(`/api/admin/users?${params.toString()}`);
    },
  });

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ user: AdminUserRowDTO; next: "SUSPENDED" | "BANNED" | "ACTIVE" } | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUserRowDTO | null>(null);
  const [roleValue, setRoleValue] = useState<(typeof ROLES)[number]>("USER");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  async function patchUser(id: string, body: { status?: string; role?: string }, successMsg: string) {
    setBusyId(id);
    try {
      await api.patch(`/api/admin/users/${id}`, body);
      toast.success(successMsg);
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const rows = list.data?.users ?? [];

  return (
    <div className="space-y-3">
      {/* filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t("admin.searchUsers")}
          className="sm:max-w-xs"
        />
        <Select value={status} onValueChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-40" aria-label={t("common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("common.all")}</SelectItem>
            <SelectItem value="ACTIVE">{t("admin.st.ACTIVE")}</SelectItem>
            <SelectItem value="SUSPENDED">{t("admin.st.SUSPENDED")}</SelectItem>
            <SelectItem value="BANNED">{t("admin.st.BANNED")}</SelectItem>
          </SelectContent>
        </Select>
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
                <TableHead>{t("admin.user")}</TableHead>
                <TableHead>{t("admin.role")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("admin.balance")}</TableHead>
                <TableHead className="text-right">{t("admin.totalStaked")}</TableHead>
                <TableHead className="text-right">{t("admin.betsCount")}</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={9} className="p-2">
                    <TableSkeleton rows={6} cols={8} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <EmptyState colSpan={9} />
              ) : (
                rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{u.fullName}</span>
                        <span className="text-xs text-muted-foreground">{u.phone}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatETB(u.balanceCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatETB(u.totalStakedCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.betsCount}</TableCell>
                    <TableCell>
                      <StatusBadge status={u.kycStatus} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busyId === u.id}>
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">{t("common.actions")}</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {u.status !== "ACTIVE" && (
                            <DropdownMenuItem onClick={() => setConfirmAction({ user: u, next: "ACTIVE" })}>
                              <ShieldCheck className="h-4 w-4" />
                              {t("admin.activate")}
                            </DropdownMenuItem>
                          )}
                          {u.status === "ACTIVE" && (
                            <DropdownMenuItem
                              className="text-[var(--chart-2)]"
                              onClick={() => setConfirmAction({ user: u, next: "SUSPENDED" })}
                            >
                              {t("admin.suspend")}
                            </DropdownMenuItem>
                          )}
                          {u.status !== "BANNED" && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setConfirmAction({ user: u, next: "BANNED" })}
                            >
                              {t("admin.ban")}
                            </DropdownMenuItem>
                          )}
                          {isSuperAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>{t("admin.role")}</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRoleTarget(u);
                                  setRoleValue((ROLES as readonly string[]).includes(u.role) ? (u.role as (typeof ROLES)[number]) : "USER");
                                }}
                              >
                                {t("admin.changeRole")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* confirm status change (suspend / ban / activate) */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.next === "BANNED"
                ? t("admin.ban")
                : confirmAction?.next === "SUSPENDED"
                  ? t("admin.suspend")
                  : t("admin.activate")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.next === "BANNED"
                ? t("admin.confirmBan")
                : confirmAction?.next === "SUSPENDED"
                  ? t("admin.confirmSuspend")
                  : t("admin.confirmActivate")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction?.next === "BANNED" ? "bg-destructive text-white hover:bg-destructive/90" : ""}
              onClick={(e) => {
                e.preventDefault();
                if (!confirmAction) return;
                void patchUser(confirmAction.user.id, { status: confirmAction.next }, t("admin.userUpdated"));
                setConfirmAction(null);
              }}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* change role dialog (SUPER_ADMIN only) */}
      <Dialog open={roleTarget !== null} onOpenChange={(open) => !open && setRoleTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("admin.changeRole")}</DialogTitle>
            <DialogDescription>
              {roleTarget?.fullName} · {roleTarget?.phone}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-role">{t("admin.role")}</Label>
            <Select value={roleValue} onValueChange={(v) => setRoleValue(v as (typeof ROLES)[number])}>
              <SelectTrigger id="admin-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busyId !== null}
              onClick={() => {
                if (!roleTarget) return;
                void patchUser(roleTarget.id, { role: roleValue }, t("admin.roleUpdated"));
                setRoleTarget(null);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
