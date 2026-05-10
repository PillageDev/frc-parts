"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Clock,
  ExternalLink,
  FileDown,
  FileText,
  GitBranch,
  ListChecks,
  Paperclip,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PartThumbnail } from "@/components/parts/part-thumbnail";
import { OperationRow } from "@/components/parts/operation-row";
import { AddStepForm } from "@/components/parts/add-step-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";
import {
  PART_STATUSES,
  PRIORITIES,
} from "@/lib/db/schema";
import {
  priorityClass,
  priorityLabel,
  statusClass,
  statusLabel,
  stockTypeLabel,
} from "@/lib/labels";
import {
  formatBox,
  formatGrams,
  formatMinutes,
  formatVolume,
  timeAgo,
} from "@/lib/utils";
import { toast } from "sonner";

export default function PartDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const part = trpc.parts.byId.useQuery({ id });
  const machines = trpc.machines.list.useQuery();
  const utils = trpc.useUtils();

  const setStatus = trpc.parts.setStatus.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });
  const setPriority = trpc.parts.setPriority.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });
  const setStockType = trpc.parts.setStockType.useMutation({
    onSuccess: () => {
      utils.parts.byId.invalidate();
      toast.success("Stock type updated and re-routed");
    },
  });
  const start = trpc.parts.startManufacturing.useMutation({
    onSuccess: (res) => {
      utils.parts.byId.invalidate();
      utils.parts.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.machines.list.invalidate();
      if (!res.ok) {
        toast.message("Already complete");
      } else {
        toast.success(`Queued: ${res.firstStep}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const deletePart = trpc.parts.delete.useMutation({
    onSuccess: () => {
      utils.parts.list.invalidate();
      utils.parts.kanban.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Part deleted");
      router.push("/parts");
    },
    onError: (e) => toast.error(e.message),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = trpc.parts.update.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });
  const updateToVersion = trpc.parts.updateToVersion.useMutation({
    onSuccess: (res) => {
      utils.parts.byId.invalidate();
      utils.parts.list.invalidate();
      toast.success(`Re-pinned to "${res.versionName}"`);
    },
    onError: (e) => toast.error(e.message),
  });
  const setBatchKey = trpc.parts.setBatchKey.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });

  const [batchDraft, setBatchDraft] = useState<string>("");

  if (part.isLoading || !part.data) {
    return <div className="text-sm text-muted-foreground">Loading part…</div>;
  }
  const p = part.data;
  const machineList = machines.data?.map((m) => m.machine) ?? [];
  const totalActual = p.operations.reduce(
    (acc, op) => acc + (op.actualMinutes ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/parts"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to all parts
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <div className="flex flex-col gap-3">
          <PartThumbnail url={p.thumbnailUrl} alt={p.name} />
          {p.onshapeUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={p.onshapeUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Onshape
              </a>
            </Button>
          )}
          {p.onshapeDocumentId && (
            <UpdateVersionButton
              partId={p.id}
              documentId={p.onshapeDocumentId}
              currentVersionId={p.onshapeVersionId}
              onUpdate={(versionId, versionName) =>
                updateToVersion.mutate({
                  id: p.id,
                  versionId,
                  versionName,
                })
              }
              isPending={updateToVersion.isPending}
            />
          )}
          {p.type === "custom" && p.operations.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => start.mutate({ id: p.id })}
              disabled={start.isPending || p.status === "done" || p.status === "on_robot"}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              {p.status === "ready_to_make" ? "Start manufacturing" : "Resume"}
            </Button>
          )}
          {p.type === "custom" && p.operations.length > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/parts/${p.id}/run`}>
                <ListChecks className="h-3.5 w-3.5" />
                Step through
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/parts/${p.id}/instructions`} target="_blank">
              <FileText className="h-3.5 w-3.5" />
              Export instructions
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-serif text-3xl font-semibold tracking-tight">
                  {p.name}
                </h1>
                <code className="font-mono text-sm text-muted-foreground">
                  {p.partNumber}
                </code>
                {p.type === "cots" && <Badge variant="muted">COTS</Badge>}
              </div>
              {p.assembly && (
                <Link
                  href={`/assemblies/${p.assembly.id}`}
                  className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
                >
                  <Box className="h-3 w-3" />
                  Part of {p.assembly.name}
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={p.status}
                onValueChange={(v) =>
                  setStatus.mutate({
                    id: p.id,
                    status: v as (typeof PART_STATUSES)[number],
                  })
                }
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue>
                    <span
                      className={
                        "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium " +
                        statusClass(p.status)
                      }
                    >
                      {statusLabel[p.status]}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PART_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={p.priority}
                onValueChange={(v) =>
                  setPriority.mutate({
                    id: p.id,
                    priority: v as (typeof PRIORITIES)[number],
                  })
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue>
                    <span
                      className={
                        "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 " +
                        priorityClass(p.priority)
                      }
                    >
                      {priorityLabel[p.priority]}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {priorityLabel[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {p.type === "custom" && (
                <PartStockTypeSelect
                  current={p.stockType}
                  onChange={(v) =>
                    setStockType.mutate({ id: p.id, stockType: v })
                  }
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfirmDelete(true)}
                title="Delete part"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Material" value={p.material ?? "—"} />
            <Stat
              label="Mass"
              value={p.massGrams != null ? formatGrams(p.massGrams) : "—"}
            />
            <Stat
              label="Volume"
              value={p.volumeMm3 != null ? formatVolume(p.volumeMm3) : "—"}
            />
            <Stat
              label="Bounding box"
              value={
                p.bboxXMm != null && p.bboxYMm != null && p.bboxZMm != null
                  ? formatBox({ x: p.bboxXMm, y: p.bboxYMm, z: p.bboxZMm })
                  : "—"
              }
            />
            <Stat label="Quantity needed" value={`× ${p.quantity}`} />
            <Stat
              label="Actual logged"
              value={totalActual > 0 ? formatMinutes(totalActual) : "—"}
            />
            <Stat
              label="Onshape version"
              value={
                p.onshapeVersionName ? (
                  <span className="font-mono text-xs">{p.onshapeVersionName}</span>
                ) : p.onshapeVersionId ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {p.onshapeVersionId.slice(0, 8)}…
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
            <Stat
              label="Last synced"
              value={p.lastSyncedAt ? timeAgo(p.lastSyncedAt) : "Never"}
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="ops">
        <TabsList>
          <TabsTrigger value="ops">Operations</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="revisions">Revisions</TabsTrigger>
          <TabsTrigger value="meta">Notes & Batch</TabsTrigger>
        </TabsList>

        <TabsContent value="ops" className="flex flex-col gap-3">
          {p.type === "cots" ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                COTS part — no manufacturing operations.
              </CardContent>
            </Card>
          ) : (
            <>
              {p.operations.map((op, i) => (
                <OperationRow
                  key={op.id}
                  op={op}
                  machine={op.machine ?? null}
                  machines={machineList}
                  index={i}
                />
              ))}
              {p.operations.length === 0 && (
                <Card>
                  <CardContent className="py-6 text-sm text-muted-foreground text-center">
                    No operations yet — add the first step below.
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Add manual step
                  </CardTitle>
                  <CardDescription>
                    Designers can override auto-routing or insert ad-hoc steps
                    like “Tap holes after CNC” or “Sand after laser cut.”
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AddStepForm partId={p.id} machines={machineList} />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="files">
          <FilesTab partId={p.id} attachments={p.attachments} />
        </TabsContent>

        <TabsContent value="revisions">
          <Card>
            <CardHeader>
              <CardTitle>Revision history</CardTitle>
              <CardDescription>
                Tied to Onshape document microversions. Mid-fabrication design
                changes get flagged here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {p.revisions.map((rev) => (
                <div
                  key={rev.id}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <div
                    className={
                      "flex h-8 w-8 items-center justify-center rounded-md shrink-0 " +
                      (rev.flagged
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    <GitBranch className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium">{rev.versionLabel}</div>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {rev.onshapeMicroversionId ?? "—"}
                      </code>
                      {rev.flagged && (
                        <Badge variant="warning">Flagged for review</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {rev.changeSummary ?? "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {timeAgo(rev.createdAt)}{" "}
                      {rev.massGrams != null && (
                        <span> · {formatGrams(rev.massGrams)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {p.revisions.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No revisions yet.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="meta" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>
                Manufacturing context, finishes, fixturing tips.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Tap M3 holes after CNC. Aluminum is 1/4&quot; plate."
                defaultValue={p.notes ?? ""}
                onBlur={(e) =>
                  update.mutate({ id: p.id, notes: e.target.value })
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Batch grouping</CardTitle>
              <CardDescription>
                Group similar parts (e.g., all 6 gussets) so they run in the
                same machine session.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Input
                placeholder="Batch label (e.g. gusset-batch-1)"
                value={batchDraft || (p.batchKey ?? "")}
                onChange={(e) => setBatchDraft(e.target.value)}
              />
              <Button
                onClick={() =>
                  setBatchKey.mutate({
                    id: p.id,
                    batchKey: batchDraft.trim() || null,
                  })
                }
              >
                Save
              </Button>
              {p.batchKey && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setBatchKey.mutate({ id: p.id, batchKey: null })
                  }
                >
                  Clear
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this part?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{p.name}</strong> ({p.partNumber})
              along with all of its operations, revisions, and attached files.
              The Onshape document is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deletePart.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletePart.mutate({ id: p.id })}
              disabled={deletePart.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete part
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UpdateVersionButton({
  partId,
  documentId,
  currentVersionId,
  onUpdate,
  isPending,
}: {
  partId: string;
  documentId: string;
  currentVersionId: string | null;
  onUpdate: (versionId: string, versionName: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const versions = trpc.parts.documentVersions.useQuery(
    { documentId },
    { enabled: open, retry: false },
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={isPending}
      >
        <GitBranch className="h-3.5 w-3.5" />
        Update version
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-pin to a different Onshape version</DialogTitle>
            <DialogDescription>
              Pulls the part&apos;s mass / volume / bbox / thumbnail from the
              chosen version and writes a revision row. Operations and notes
              are preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
            {versions.isFetching && (
              <div className="text-xs text-muted-foreground py-3 text-center">
                Loading versions…
              </div>
            )}
            {versions.error && (
              <div className="text-xs text-destructive py-3 text-center">
                {versions.error.message}
              </div>
            )}
            {versions.data?.map((v) => {
              const isCurrent = v.id === currentVersionId;
              return (
                <button
                  key={v.id}
                  disabled={isCurrent || isPending}
                  onClick={() => {
                    onUpdate(v.id, v.name);
                    setOpen(false);
                  }}
                  className={
                    "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors " +
                    (isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted")
                  }
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-medium text-sm">{v.name}</span>
                    {isCurrent && (
                      <Badge variant="muted" className="text-[10px]">
                        current
                      </Badge>
                    )}
                  </div>
                  {v.createdAt && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {new Date(v.createdAt).toLocaleString()}
                    </span>
                  )}
                  {v.description && (
                    <span className="text-[11px] text-muted-foreground line-clamp-2">
                      {v.description}
                    </span>
                  )}
                </button>
              );
            })}
            {versions.data?.length === 0 && (
              <div className="text-sm text-muted-foreground py-3 text-center">
                No versions in this document yet.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PartStockTypeSelect({
  current,
  onChange,
}: {
  current: string;
  onChange: (v: string) => void;
}) {
  const templates = trpc.templates.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const matched = templates.data?.find((t) => t.key === current);
  const fallbackLabel =
    (stockTypeLabel as Record<string, string | undefined>)[current] ?? current;
  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue>{matched?.label ?? fallbackLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto-detect (re-route)</SelectItem>
        {(templates.data ?? []).map((t) => (
          <SelectItem key={t.key} value={t.key}>
            {t.label}
            {!t.isAutoDetectable && (
              <span className="ml-2 text-[10px] text-muted-foreground">
                custom
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

function FilesTab({
  partId,
  attachments,
}: {
  partId: string;
  attachments: Array<{
    id: string;
    fileName: string;
    fileKind: string;
    sizeBytes: number;
    url: string;
    createdAt: Date;
  }>;
}) {
  const utils = trpc.useUtils();
  const add = trpc.parts.addAttachment.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });
  const remove = trpc.parts.removeAttachment.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job files</CardTitle>
        <CardDescription>
          Attach the .gcode, .nc, .dxf, .svg, .stl, or .step the operator needs
          to run this job. Files live alongside the part so the operator never
          has to dig.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          type="file"
          className="block text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:cursor-pointer hover:file:bg-accent"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const ext = file.name.split(".").pop()?.toLowerCase() ?? "other";
            const allowed = [
              "gcode",
              "nc",
              "dxf",
              "svg",
              "stl",
              "step",
              "pdf",
            ] as const;
            const fileKind: (typeof allowed)[number] | "other" =
              (allowed as readonly string[]).includes(ext)
                ? (ext as (typeof allowed)[number])
                : "other";

            const reader = new FileReader();
            const url = await new Promise<string>((resolve) => {
              reader.onload = () => resolve(String(reader.result));
              reader.readAsDataURL(file);
            });
            add.mutate({
              partId,
              fileName: file.name,
              fileKind,
              sizeBytes: file.size,
              url,
            });
            e.target.value = "";
          }}
        />
        <div className="flex flex-col gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                <Paperclip className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">
                  {att.fileName}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {att.fileKind} · {(att.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                  {timeAgo(att.createdAt)}
                </div>
              </div>
              <Button asChild variant="ghost" size="icon">
                <a href={att.url} download={att.fileName}>
                  <FileDown className="h-4 w-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove.mutate({ id: att.id })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {attachments.length === 0 && (
            <div className="text-sm text-muted-foreground">No files yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
