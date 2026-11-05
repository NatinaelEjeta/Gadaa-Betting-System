"use client";

import { Home, Trophy, Radio, Receipt, Wallet as WalletIcon, LayoutDashboard } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { BetSlip } from "@/components/app/bet-slip";
import { useI18n } from "@/lib/i18n";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useSession, useLiveSocket } from "@/hooks/use-data";
import { useAppState, View } from "@/stores/app-state";
import { cn } from "@/lib/utils";

import { HomeView } from "@/components/app/views/home-view";
import { SportsView } from "@/components/app/views/sports-view";
import { LiveView } from "@/components/app/views/live-view";
import { EventDetailView } from "@/components/app/views/event-detail-view";
import { MyBetsView } from "@/components/app/views/my-bets-view";
import { WalletView } from "@/components/app/views/wallet-view";
import { ProfileView } from "@/components/app/views/profile-view";
import { AuthView } from "@/components/app/views/auth-view";
import { AdminView } from "@/components/admin/admin-view";

const NAV: Array<{ view: View; labelKey: "nav.home" | "nav.sports" | "nav.live" | "nav.myBets" | "nav.wallet"; icon: typeof Home }> = [
  { view: "home", labelKey: "nav.home", icon: Home },
  { view: "sports", labelKey: "nav.sports", icon: Trophy },
  { view: "live", labelKey: "nav.live", icon: Radio },
  { view: "bets", labelKey: "nav.myBets", icon: Receipt },
  { view: "wallet", labelKey: "nav.wallet", icon: WalletIcon },
];

function SidebarNav() {
  const { t } = useI18n();
  const { view, navigate } = useAppState();
  const { data } = useSession();
  const isAdmin = ["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"].includes(data?.user?.role ?? "");

  return (
    <nav className="sticky top-20 hidden h-fit w-52 shrink-0 flex-col gap-1 md:flex" aria-label="Main navigation">
      {NAV.map(({ view: v, labelKey, icon: Icon }) => (
        <button
          key={v}
          onClick={() => navigate(v)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            view === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Icon className="h-4.5 w-4.5" />
          {t(labelKey)}
        </button>
      ))}
      {isAdmin && (
        <button
          onClick={() => navigate("admin")}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            view === "admin" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <LayoutDashboard className="h-4.5 w-4.5" />
          {t("nav.admin")}
        </button>
      )}
      <div className="mt-6 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">18+</p>
        <p className="mt-1">{t("footer.responsible")}</p>
      </div>
    </nav>
  );
}

function BottomNav() {
  const { t } = useI18n();
  const { view, navigate } = useAppState();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden pb-safe"
      aria-label="Bottom navigation"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.map(({ view: v, labelKey, icon: Icon }) => (
          <button
            key={v}
            onClick={() => navigate(v)}
            className={cn(
              "flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
              view === v ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={view === v ? "page" : undefined}
          >
            <Icon className="h-5 w-5" />
            {t(labelKey)}
          </button>
        ))}
      </div>
    </nav>
  );
}

function CurrentView() {
  const { view, eventId } = useAppState();
  switch (view) {
    case "home":
      return <HomeView />;
    case "sports":
      return <SportsView />;
    case "live":
      return <LiveView />;
    case "event":
      return eventId ? <EventDetailView eventId={eventId} /> : <HomeView />;
    case "bets":
      return <MyBetsView />;
    case "wallet":
      return <WalletView />;
    case "profile":
      return <ProfileView />;
    case "auth":
      return <AuthView />;
    case "admin":
      return <AdminView />;
    default:
      return <HomeView />;
  }
}

export function GadaaApp() {
  const { t } = useI18n();
  const { data } = useSession();
  const user = data?.user ?? null;
  useLiveSocket({ userId: user?.id });

  const queryClient = useQueryClient();
  const navigateTo = useAppState((s) => s.navigate);
  useEffect(() => {
    if (!user) return;
    const returning = new URLSearchParams(window.location.search).get("deposit") === "return";
    if (returning) navigateTo("wallet");
    let cancelled = false;
    api
      .post<{ checked: number; credited: number }>("/api/deposits/verify", {})
      .then((r) => {
        if (cancelled) return;
        if (r.credited > 0) {
          toast.success(t("wallet.depositSuccess"));
          void queryClient.invalidateQueries({ queryKey: ["session"] });
          void queryClient.invalidateQueries({ queryKey: ["wallet"] });
          void queryClient.invalidateQueries({ queryKey: ["transactions"] });
        } else if (returning) {
          toast.info(t("common.pending"));
        }
        if (returning) window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-3 pt-4 sm:px-4 md:pb-8">
        <SidebarNav />
        <main className="min-w-0 flex-1 pb-24 xl:pb-4">
          <CurrentView />
        </main>
        <BetSlip />
      </div>

      {/* Desktop footer — sticks to the bottom via mt-auto when content is short */}
      <footer className="mt-auto border-t bg-card/50 md:block">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Gadaa Betting · 18+</p>
          <p className="text-center">{t("footer.responsible")}</p>
        </div>
      </footer>

      <BottomNav />
    </div>
  );
}
