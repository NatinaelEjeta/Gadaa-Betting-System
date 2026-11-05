"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, Globe, LogOut, Moon, Shield, Sun, User as UserIcon, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { GadaaLogo } from "@/components/app/gadaa-logo";
import { useI18n, Language } from "@/lib/i18n";
import { formatETB, timeAgo } from "@/lib/format";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-data";
import { useAppState, View } from "@/stores/app-state";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

/** Top header: brand, balance, notifications, language, theme, account menu. */
export function AppHeader() {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const { data } = useSession();
  const navigate = useAppState((s) => s.navigate);
  const openAuth = useAppState((s) => s.openAuth);
  const queryClient = useQueryClient();
  const user = data?.user ?? null;

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: NotificationItem[]; unread: number }>("/api/notifications"),
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const markRead = async () => {
    if (!notifData?.unread) return;
    await api.post("/api/notifications", {}).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    await queryClient.invalidateQueries();
    navigate("home");
    toast.success(t("common.logout"));
  };

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-4">
        <button
          className="flex items-center gap-2"
          onClick={() => navigate("home")}
          aria-label="Gadaa Betting home"
        >
          <GadaaLogo size={30} />
          <span className="hidden text-lg font-extrabold tracking-tight sm:block">
            Gadaa <span className="text-gold">Betting</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {user ? (
            <button
              onClick={() => navigate("wallet")}
              className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-bold tabular-nums hover:border-primary/50"
            >
              <WalletIcon className="h-4 w-4 text-primary" />
              {formatETB(user.wallet?.balanceCents ?? 0)}
            </button>
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-9" onClick={() => openAuth("login")}>
                {t("common.login")}
              </Button>
              <Button size="sm" className="hidden h-9 sm:inline-flex" onClick={() => openAuth("register")}>
                {t("common.register")}
              </Button>
            </>
          )}

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Notifications">
                  <Bell className="h-4.5 w-4.5" />
                  {!!notifData?.unread && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gold" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="flex items-center justify-between">
                  {t("wallet.transactions")}
                </DropdownMenuLabel>
                <div className="max-h-72 overflow-y-auto scrollbar-thin">
                  {(notifData?.notifications ?? []).length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("common.empty")}</p>
                  )}
                  {(notifData?.notifications ?? []).map((n) => (
                    <DropdownMenuLabel key={n.id} className="font-normal">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn("truncate text-sm", !n.read && "font-semibold")}>{n.title}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                      </div>
                    </DropdownMenuLabel>
                  ))}
                </div>
                {notifData?.unread ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={markRead}>{t("common.confirm")} — mark all read</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
            <SelectTrigger className="h-9 w-[64px] border-0 bg-muted px-2.5 text-xs" aria-label={t("common.language")}>
              <Globe className="mr-0.5 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">EN</SelectItem>
              <SelectItem value="am">አማ</SelectItem>
              <SelectItem value="om">OM</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t("common.theme")}
          >
            <Sun className="h-4.5 w-4.5 dark:hidden" />
            <Moon className="hidden h-4.5 w-4.5 dark:block" />
          </Button>

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-primary/10" aria-label={t("nav.profile")}>
                  <span className="text-sm font-bold text-primary">{user.fullName.charAt(0).toUpperCase()}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold">{user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{user.phone}</p>
                  {user.kycStatus === "APPROVED" ? (
                    <Badge className="mt-1" variant="secondary">{t("profile.kycApproved")}</Badge>
                  ) : user.kycStatus === "PENDING" ? (
                    <Badge className="mt-1" variant="outline">{t("profile.kycPending")}</Badge>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("profile")}>
                  <UserIcon className="mr-2 h-4 w-4" /> {t("nav.profile")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("wallet")}>
                  <WalletIcon className="mr-2 h-4 w-4" /> {t("nav.wallet")}
                </DropdownMenuItem>
                {["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"].includes(user.role) && (
                  <DropdownMenuItem onClick={() => navigate("admin")}>
                    <Shield className="mr-2 h-4 w-4" /> {t("nav.admin")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" /> {t("common.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}

