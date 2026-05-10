"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Flag,
  FolderClosed,
  FolderInput,
  GitBranch,
  Layers,
  ListChecks,
  Package,
  PlayCircle,
  Rocket,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { PartThumbnail } from "@/components/parts/part-thumbnail";
import {
  priorityClass,
  priorityLabel,
  statusClass,
  statusLabel,
  stockTypeBadgeVariant,
  stockTypeLabel,
} from "@/lib/labels";
import {
  PART_STATUSES,
  PRIORITIES,
  type Folder,
  type Part,
  type PartStatus,
  type Priority,
  type StockType,
} from "@/lib/db/schema";
import { formatGrams, formatBox, timeAgo } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";

export function PartListRow({
  part,
  folders = [],
  selected,
  onSelectedChange,
}: {
  part: Part;
  folders?: Folder[];
  /** When provided, renders a selection checkbox and lets the parent track multi-select. */
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const utils = trpc.useUtils();
  const templates = trpc.templates.list.useQuery(undefined, {
    staleTime: 60_000,
  });

  const invalidateAll = () => {
    utils.parts.list.invalidate();
    utils.parts.kanban.invalidate();
    utils.dashboard.summary.invalidate();
    utils.assemblies.list.invalidate();
  };

  const deletePart = trpc.parts.delete.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success("Part deleted");
      setConfirm(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = trpc.parts.setStatus.useMutation({
    onSuccess: () => invalidateAll(),
  });
  const setPriority = trpc.parts.setPriority.useMutation({
    onSuccess: () => invalidateAll(),
  });
  const setStockType = trpc.parts.setStockType.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(`Stock type → ${stockTypeLabel[res.stockType]}, re-routed`);
    },
    onError: (e) => toast.error(e.message),
  });
  const setFolder = trpc.parts.setFolder.useMutation({
    onSuccess: () => {
      invalidateAll();
      utils.folders.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reroute = trpc.parts.rerouteOperations.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(
        res.steps > 0
          ? `Re-routed: ${res.steps} step${res.steps === 1 ? "" : "s"}`
          : "Nothing to re-route",
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const start = trpc.parts.startManufacturing.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      if (!res.ok) {
        toast.message("Already complete");
      } else {
        toast.success(`Manufacturing started: ${res.firstStep}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const startBatch = trpc.parts.startBatch.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(
        `Started ${res.queued} of ${res.total} parts in batch${res.alreadyDone > 0 ? ` (${res.alreadyDone} already complete)` : ""}`,
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const advance = trpc.parts.advanceStep.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      if (!res.ok) {
        if (res.reason === "all_complete") {
          toast.message("All steps complete", {
            description: "Mark the part as installed on the robot when ready.",
          });
        } else {
          toast.message("No steps to advance");
        }
        return;
      }
      if (res.action === "started") {
        toast.success(`Started "${res.stepName}"`);
      } else {
        toast.success(`Marked "${res.stepName}" complete`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={
              "group relative flex items-stretch gap-4 rounded-lg border bg-card p-3 hover:shadow-sm transition-all " +
              (selected
                ? "border-primary/60 ring-1 ring-primary/30"
                : "border-border hover:border-primary/40")
            }
          >
            <Link
              href={`/parts/${part.id}`}
              className="absolute inset-0 z-0 rounded-lg"
              aria-label={`Open ${part.name}`}
            />
            {onSelectedChange && (
              <div
                className="relative z-20 flex items-start pt-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={!!selected}
                  onCheckedChange={(c) => onSelectedChange(!!c)}
                  aria-label={`Select ${part.name}`}
                />
              </div>
            )}
            <div className="w-28 shrink-0 relative z-10 pointer-events-none">
              <PartThumbnail url={part.thumbnailUrl} alt={part.name} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-2 relative z-10 pointer-events-none">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium truncate">{part.name}</h3>
                    <span className="font-mono text-xs text-muted-foreground">
                      {part.partNumber}
                    </span>
                    {part.type === "cots" && (
                      <Badge variant="muted">COTS</Badge>
                    )}
                    {(part.onshapeVersionName || part.onshapeVersionId) && (
                      <Badge
                        variant="muted"
                        className="gap-1 font-mono text-[10px]"
                        title={
                          part.onshapeVersionName
                            ? `Pinned to Onshape version "${part.onshapeVersionName}"`
                            : `Pinned to Onshape version ${part.onshapeVersionId}`
                        }
                      >
                        <GitBranch className="h-3 w-3" />
                        {part.onshapeVersionName ??
                          `${part.onshapeVersionId!.slice(0, 8)}…`}
                      </Badge>
                    )}
                    {part.stockType && part.stockType !== "auto" && (
                      <Badge
                        variant={stockTypeBadgeVariant(part.stockType)}
                      >
                        {stockTypeLabel[part.stockType]}
                      </Badge>
                    )}
                    {part.batchKey && (
                      <Badge variant="accent">Batch · {part.batchKey}</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                    {part.material && <span>{part.material}</span>}
                    {part.bboxXMm != null &&
                      part.bboxYMm != null &&
                      part.bboxZMm != null && (
                        <span className="font-mono">
                          {formatBox({
                            x: part.bboxXMm,
                            y: part.bboxYMm,
                            z: part.bboxZMm,
                          })}
                        </span>
                      )}
                    {part.massGrams != null && (
                      <span>{formatGrams(part.massGrams)}</span>
                    )}
                    {part.lastSyncedAt && (
                      <span>synced {timeAgo(part.lastSyncedAt)}</span>
                    )}
                    <span>×{part.quantity}</span>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={
                    "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium " +
                    statusClass(part.status)
                  }
                >
                  {statusLabel[part.status]}
                </span>
                <span
                  className={
                    "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 " +
                    priorityClass(part.priority)
                  }
                >
                  {priorityLabel[part.priority]}
                </span>
                {part.onshapeUrl && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <ExternalLink className="h-3 w-3" /> Onshape
                  </span>
                )}
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 z-20 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive bg-card/80 backdrop-blur"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirm(true);
              }}
              title="Delete part"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuLabel>{part.name}</ContextMenuLabel>

          {part.type === "custom" && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Layers className="h-4 w-4" />
                Stock type
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {templates.data?.find((t) => t.key === part.stockType)
                    ?.label ??
                    (part.stockType !== "auto"
                      ? (stockTypeLabel as Record<string, string | undefined>)[
                          part.stockType
                        ] ?? part.stockType
                      : "")}
                </span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={part.stockType}
                  onValueChange={(v) =>
                    setStockType.mutate({
                      id: part.id,
                      stockType: v as StockType,
                    })
                  }
                >
                  <ContextMenuRadioItem value="auto">
                    Auto-detect
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      re-route
                    </span>
                  </ContextMenuRadioItem>
                  {(templates.data ?? []).map((t) => (
                    <ContextMenuRadioItem key={t.key} value={t.key}>
                      {t.label}
                      {!t.isAutoDetectable && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          custom
                        </span>
                      )}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput className="h-4 w-4" />
              Folder
              <span className="ml-auto text-[11px] text-muted-foreground">
                {folders.find((f) => f.id === part.folderId)?.name ?? "—"}
              </span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={part.folderId ?? "__none__"}
                onValueChange={(v) =>
                  setFolder.mutate({
                    id: part.id,
                    folderId: v === "__none__" ? null : v,
                  })
                }
              >
                <ContextMenuRadioItem value="__none__">
                  No folder
                </ContextMenuRadioItem>
                {folders.map((f) => (
                  <ContextMenuRadioItem key={f.id} value={f.id}>
                    <FolderClosed
                      className="h-3 w-3 mr-1"
                      style={{ color: f.color || undefined }}
                    />
                    {f.name}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ListChecks className="h-4 w-4" />
              Status
              <span className="ml-auto text-[11px] text-muted-foreground">
                {statusLabel[part.status]}
              </span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={part.status}
                onValueChange={(v) =>
                  setStatus.mutate({ id: part.id, status: v as PartStatus })
                }
              >
                {PART_STATUSES.map((s) => (
                  <ContextMenuRadioItem key={s} value={s}>
                    {statusLabel[s]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Flag className="h-4 w-4" />
              Priority
              <span className="ml-auto text-[11px] text-muted-foreground">
                {priorityLabel[part.priority]}
              </span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={part.priority}
                onValueChange={(v) =>
                  setPriority.mutate({
                    id: part.id,
                    priority: v as Priority,
                  })
                }
              >
                {PRIORITIES.map((p) => (
                  <ContextMenuRadioItem key={p} value={p}>
                    {priorityLabel[p]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />

          {part.type === "custom" && (
            <>
              {part.status === "ready_to_make" && (
                <ContextMenuItem
                  onSelect={() => start.mutate({ id: part.id })}
                  disabled={start.isPending}
                >
                  <Rocket className="h-4 w-4" />
                  Start manufacturing
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onSelect={() => advance.mutate({ partId: part.id })}
                disabled={advance.isPending}
              >
                {part.status === "in_production" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                Advance current step
              </ContextMenuItem>
              {part.batchKey && (
                <ContextMenuItem
                  onSelect={() =>
                    startBatch.mutate({ batchKey: part.batchKey! })
                  }
                  disabled={startBatch.isPending}
                >
                  <Package className="h-4 w-4" />
                  Start batch &quot;{part.batchKey}&quot;
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onSelect={() => reroute.mutate({ id: part.id })}
                disabled={reroute.isPending}
              >
                <Layers className="h-4 w-4" />
                Re-route from template
              </ContextMenuItem>
            </>
          )}

          {part.onshapeUrl && (
            <ContextMenuItem
              onSelect={() => window.open(part.onshapeUrl!, "_blank")}
            >
              <ExternalLink className="h-4 w-4" />
              Open in Onshape
            </ContextMenuItem>
          )}

          <ContextMenuSeparator />

          <ContextMenuItem
            destructive
            onSelect={() => setConfirm(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete part
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this part?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{part.name}</strong> ({part.partNumber})
              along with all of its operations, revisions, and attached files.
              The Onshape document is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirm(false)}
              disabled={deletePart.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletePart.mutate({ id: part.id })}
              disabled={deletePart.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
