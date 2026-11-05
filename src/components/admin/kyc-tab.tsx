"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardsSkeleton, ErrorNote, InlineSpinner, PageNav, StatusBadge, ageFromDob, errMsg } from "@/components/admin/admin-ui";

interface KycDocRow {
  id: string;
  docType: string;
  docNumber: string;
  dateOfBirth: string | null;
  status: string;
  reviewerNote: string | null;
  createdAt: string;
  frontImage: string;
  backImage: string | null;
  user: {
    id: string;
    phone: string;
    fullName: string;
    dateOfBirth: string | null;
    createdAt: string;
  };
}

type KycPage = { documents: KycDocRow[]; total: number; page: number; totalPages: number };
type KycFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

export function KycTab() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<KycFilter>("PENDING");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["admin", "kyc", { filter, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (filter !== "ALL") params.set("status", filter);
      return api.get<KycPage>(`/api/admin/kyc?${params.toString()}`);
    },
  });

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<KycDocRow | null>(null);
  const [note, setNote] = useState("");
  const [imageViewer, setImageViewer] = useState<{ src: string; title: string } | null>(null);

  async function review(id: string, action: "APPROVE" | "REJECT", reviewNote?: string) {
    setBusyId(id);
    try {
      await api.post(`/api/admin/kyc/${id}`, { action, note: reviewNote || undefined });
      toast.success(action === "APPROVE" ? t("admin.kycApproved") : t("admin.kycRejected"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const docs = list.data?.documents ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filter} onValueChange={(v) => { setFilter(v as KycFilter); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">{t("admin.st.PENDING")}</SelectItem>
            <SelectItem value="APPROVED">{t("admin.st.APPROVED")}</SelectItem>
            <SelectItem value="REJECTED">{t("admin.st.REJECTED")}</SelectItem>
            <SelectItem value="ALL">{t("common.all")}</SelectItem>
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
      ) : list.isLoading ? (
        <CardsSkeleton count={3} />
      ) : docs.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("admin.noResults")}</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {docs.map((doc) => {
            const age = ageFromDob(doc.dateOfBirth ?? doc.user.dateOfBirth);
            const underage = age !== null && age < 18;
            return (
              <Card key={doc.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{doc.user.fullName}</p>
                      <p className="text-xs text-muted-foreground">{doc.user.phone}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {underage ? (
                        <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                          {t("admin.underage")}
                        </Badge>
                      ) : age !== null ? (
                        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                          {t("admin.age", { age })}
                        </Badge>
                      ) : null}
                      <StatusBadge status={doc.status} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">{t("profile.docType")}</span>
                    <span className="font-medium">{doc.docType}</span>
                    <span className="text-muted-foreground">{t("profile.docNumber")}</span>
                    <span className="font-medium tabular-nums">{doc.docNumber}</span>
                    <span className="text-muted-foreground">{t("profile.dateOfBirth")}</span>
                    <span className="font-medium tabular-nums">{doc.dateOfBirth ?? doc.user.dateOfBirth ?? "—"}</span>
                    <span className="text-muted-foreground">{t("common.date")}</span>
                    <span className="font-medium">{formatDateTime(doc.createdAt)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <figure className="space-y-1">
                      <button
                        type="button"
                        className="group relative block w-full overflow-hidden rounded-md border"
                        onClick={() => setImageViewer({ src: doc.frontImage, title: t("admin.frontImage") })}
                        aria-label={t("admin.frontImage")}
                      >
                        <img
                          src={doc.frontImage}
                          alt={t("admin.frontImage")}
                          className="h-40 max-h-56 w-full object-contain bg-muted/40"
                        />
                        <span className="absolute right-1.5 top-1.5 rounded-md bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <ZoomIn className="h-4 w-4" />
                        </span>
                      </button>
                      <figcaption className="text-center text-[11px] text-muted-foreground">{t("admin.frontImage")}</figcaption>
                    </figure>
                    {doc.backImage ? (
                      <figure className="space-y-1">
                        <button
                          type="button"
                          className="group relative block w-full overflow-hidden rounded-md border"
                          onClick={() => setImageViewer({ src: doc.backImage as string, title: t("admin.backImage") })}
                          aria-label={t("admin.backImage")}
                        >
                          <img
                            src={doc.backImage}
                            alt={t("admin.backImage")}
                            className="h-40 max-h-56 w-full object-contain bg-muted/40"
                          />
                          <span className="absolute right-1.5 top-1.5 rounded-md bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <ZoomIn className="h-4 w-4" />
                          </span>
                        </button>
                        <figcaption className="text-center text-[11px] text-muted-foreground">{t("admin.backImage")}</figcaption>
                      </figure>
                    ) : (
                      <div className="flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                        {t("admin.noBackImage")}
                      </div>
                    )}
                  </div>

                  {doc.status === "PENDING" && (
                    <div className="flex justify-end gap-2 border-t pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busyId === doc.id}
                        onClick={() => {
                          setRejectTarget(doc);
                          setNote("");
                        }}
                      >
                        {t("admin.reject")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === doc.id}
                        onClick={() => void review(doc.id, "APPROVE")}
                      >
                        {busyId === doc.id ? <InlineSpinner /> : <Check className="h-4 w-4" />}
                        {t("admin.approve")}
                      </Button>
                    </div>
                  )}
                  {doc.reviewerNote && doc.status !== "PENDING" && (
                    <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                      “{doc.reviewerNote}”
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* reject with note */}
      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.rejectNoteTitle")}</DialogTitle>
            <DialogDescription>{t("admin.rejectNoteDesc")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("admin.note")}
            rows={3}
            maxLength={300}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busyId !== null}
              onClick={() => {
                if (!rejectTarget) return;
                void review(rejectTarget.id, "REJECT", note.trim() || undefined);
                setRejectTarget(null);
              }}
            >
              {busyId !== null ? <InlineSpinner /> : null}
              {t("admin.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* full-size image viewer */}
      <Dialog open={imageViewer !== null} onOpenChange={(open) => !open && setImageViewer(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{imageViewer?.title}</DialogTitle>
          </DialogHeader>
          {imageViewer && (
            <img
              src={imageViewer.src}
              alt={imageViewer.title}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
