"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FolderClosed,
  FolderPlus,
  GitMerge,
  Inbox,
  Layers,
  Loader2,
  Package,
  Pencil,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PartListRow } from "@/components/parts/part-list-row";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PART_STATUSES, PRIORITIES } from "@/lib/db/schema";
import { priorityLabel, statusLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type FolderFilter = "all" | "unassigned" | { id: string };

export default function PartsPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground">Loading parts…</div>
      }
    >
      <PartsInner />
    </Suspense>
  );
}

function PartsInner() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchKeyDraft, setBatchKeyDraft] = useState("");

  const utils = trpc.useUtils();
  const folders = trpc.folders.list.useQuery();
  const batches = trpc.parts.listBatches.useQuery();
  const groupAsBatch = trpc.parts.groupAsBatch.useMutation({
    onSuccess: () => {
      utils.parts.list.invalidate();
      utils.parts.listBatches.invalidate();
      toast.success("Batch created");
      setBatchDialogOpen(false);
      setBatchKeyDraft("");
      setSelectedIds(new Set());
    },
    onError: (e) => toast.error(e.message),
  });
  const bulkSetFolder = trpc.parts.bulkSetFolder.useMutation({
    onSuccess: (res) => {
      utils.parts.list.invalidate();
      utils.folders.list.invalidate();
      toast.success(`Moved ${res.moved} part${res.moved === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
    },
    onError: (e) => toast.error(e.message),
  });
  // Fire-and-forget: backfill missing onshapeVersionName for older imports.
  // The mutation is idempotent — returns { scanned: 0 } when nothing's left.
  const backfillVersionNames = trpc.parts.backfillVersionNames.useMutation({
    onSuccess: (res) => {
      if (res.updated > 0) {
        utils.parts.list.invalidate();
      }
    },
  });
  const ranBackfillRef = useRef(false);
  useEffect(() => {
    if (ranBackfillRef.current) return;
    ranBackfillRef.current = true;
    backfillVersionNames.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bulkStart = trpc.parts.bulkStartManufacturing.useMutation({
    onSuccess: (res) => {
      utils.parts.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.machines.list.invalidate();
      toast.success(
        `Started ${res.queued} of ${res.total} part${res.total === 1 ? "" : "s"}`,
      );
      setSelectedIds(new Set());
    },
    onError: (e) => toast.error(e.message),
  });
  const startBatch = trpc.parts.startBatch.useMutation({
    onSuccess: (res) => {
      utils.parts.list.invalidate();
      utils.parts.listBatches.invalidate();
      utils.dashboard.summary.invalidate();
      utils.machines.list.invalidate();
      toast.success(
        `Started ${res.queued} of ${res.total} parts${res.alreadyDone > 0 ? ` (${res.alreadyDone} already complete)` : ""}`,
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const list = trpc.parts.list.useQuery(
    {
      search: search || undefined,
      status: status === "all" ? undefined : (status as "ready_to_make"),
      priority: priority === "all" ? undefined : (priority as "high"),
      type: type === "all" ? undefined : (type as "custom" | "cots"),
      folderId:
        folderFilter === "all"
          ? undefined
          : folderFilter === "unassigned"
            ? null
            : folderFilter.id,
    },
    { refetchInterval: 30_000 },
  );

  const total = list.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Parts
          </h1>
          <p className="text-muted-foreground mt-1">
            Every part imported from Onshape, pinned to a specific Version.
            Re-pin individually or in bulk when the design moves forward.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/templates">
              <Layers className="h-4 w-4" />
              Templates
            </Link>
          </Button>
          <Button asChild>
            <Link href="/import">
              <Plus className="h-4 w-4" />
              Import
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <FolderSidebar
          selected={folderFilter}
          onSelect={setFolderFilter}
          folders={folders.data?.folders ?? []}
          unassignedCount={folders.data?.unassignedCount ?? 0}
          totalCount={(folders.data?.folders ?? []).reduce(
            (n, f) => n + Number(f.partCount),
            (folders.data?.unassignedCount ?? 0),
          )}
        />

        <div className="flex flex-col gap-3">
          {(batches.data ?? []).length > 0 && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2 flex-wrap">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Batches
                </div>
                {batches.data?.map((b) => {
                  const allDone = b.done === b.count;
                  const allInProgress = b.inProduction === b.count;
                  return (
                    <div
                      key={b.batchKey}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1"
                    >
                      <Badge variant="accent" className="font-mono">
                        {b.batchKey}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {b.done}/{b.count} done
                        {b.inProduction > 0 && ` · ${b.inProduction} active`}
                        {b.ready > 0 && ` · ${b.ready} waiting`}
                      </span>
                      {!allDone && !allInProgress && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() =>
                            startBatch.mutate({ batchKey: b.batchKey })
                          }
                          disabled={startBatch.isPending}
                        >
                          <Rocket className="h-3 w-3" />
                          Start batch
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, part number, material…"
                  className="pl-8"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {PART_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {priorityLabel[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="cots">COTS</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="muted" className="font-mono">
                {total} {total === 1 ? "part" : "parts"}
              </Badge>
            </CardContent>
          </Card>

          {selectedIds.size > 0 && (
            <Card className="border-primary/60 bg-primary/5">
              <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium">
                  {selectedIds.size} selected
                </span>
                <span className="text-xs text-muted-foreground hidden md:inline">
                  ·
                </span>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setBatchDialogOpen(true)}
                >
                  <Package className="h-3.5 w-3.5" />
                  Group as batch
                </Button>
                <Select
                  value=""
                  onValueChange={(v) => {
                    bulkSetFolder.mutate({
                      ids: [...selectedIds],
                      folderId: v === "__none__" ? null : v,
                    });
                  }}
                >
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue placeholder="Move to folder…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No folder</SelectItem>
                    {(folders.data?.folders ?? []).map((f) => (
                      <SelectItem key={f.folder.id} value={f.folder.id}>
                        {f.folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    bulkStart.mutate({ ids: [...selectedIds] })
                  }
                  disabled={bulkStart.isPending}
                >
                  <Rocket className="h-3.5 w-3.5" />
                  Start manufacturing
                </Button>
                <BulkUpdateVersionButton
                  selectedIds={selectedIds}
                  parts={list.data ?? []}
                  onDone={() => setSelectedIds(new Set())}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-auto"
                >
                  Clear
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {list.data?.map((p) => (
              <PartListRow
                key={p.id}
                part={p}
                folders={folders.data?.folders.map((f) => f.folder) ?? []}
                selected={selectedIds.has(p.id)}
                onSelectedChange={(c) =>
                  setSelectedIds((s) => {
                    const next = new Set(s);
                    if (c) next.add(p.id);
                    else next.delete(p.id);
                    return next;
                  })
                }
              />
            ))}
            {list.isLoading && (
              <div className="text-sm text-muted-foreground">
                Loading parts…
              </div>
            )}
            {list.data?.length === 0 && (
              <Card className="xl:col-span-2">
                <CardContent className="flex flex-col items-center text-center gap-3 py-10">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-serif text-lg">
                    {folderFilter === "all"
                      ? "No parts yet"
                      : "No parts in this folder"}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Import a part — or an entire assembly — straight from
                    Onshape. You can group parts into folders by subsystem
                    later.
                  </p>
                  <Button asChild>
                    <Link href="/import">
                      <Plus className="h-4 w-4" />
                      Import from Onshape
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Group as batch</DialogTitle>
            <DialogDescription>
              Tag {selectedIds.size} part
              {selectedIds.size === 1 ? "" : "s"} with a shared batch label so
              they run together. You can still start them individually later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batch-key">Batch label</Label>
            <Input
              id="batch-key"
              placeholder="e.g. gussets-batch-1"
              value={batchKeyDraft}
              onChange={(e) => setBatchKeyDraft(e.target.value)}
              autoFocus
            />
            <span className="text-[11px] text-muted-foreground">
              Shows up as a chip on each part and on the Batches strip above
              the parts list.
            </span>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBatchDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                groupAsBatch.mutate({
                  ids: [...selectedIds],
                  batchKey: batchKeyDraft.trim() || `batch-${Date.now().toString(36)}`,
                })
              }
              disabled={groupAsBatch.isPending}
            >
              <Package className="h-4 w-4" />
              Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BulkUpdateVersionButton({
  selectedIds,
  parts,
  onDone,
}: {
  selectedIds: Set<string>;
  parts: Array<{
    id: string;
    onshapeDocumentId: string | null;
    onshapeVersionId: string | null;
  }>;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  // Bulk update is only meaningful when all selected parts share a doc.
  const selectedParts = parts.filter((p) => selectedIds.has(p.id));
  const docs = new Set(
    selectedParts
      .map((p) => p.onshapeDocumentId)
      .filter((d): d is string => !!d),
  );
  const sharedDocumentId = docs.size === 1 ? [...docs][0] : null;

  const versions = trpc.parts.documentVersions.useQuery(
    { documentId: sharedDocumentId ?? "" },
    { enabled: open && !!sharedDocumentId, retry: false },
  );
  const bulkUpdate = trpc.parts.bulkUpdateToVersion.useMutation({
    onSuccess: (res) => {
      utils.parts.list.invalidate();
      utils.dashboard.summary.invalidate();
      if (res.failed > 0) {
        toast.warning(
          `Updated ${res.updated}; ${res.failed} failed. Check the console.`,
        );
        // eslint-disable-next-line no-console
        console.warn("Bulk version update errors:", res.errors);
      } else {
        toast.success(
          `Updated ${res.updated} part${res.updated === 1 ? "" : "s"}`,
        );
      }
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!sharedDocumentId}
        title={
          sharedDocumentId
            ? "Re-pin all selected parts to a chosen Onshape version"
            : "Select parts from a single Onshape document to bulk-update"
        }
      >
        <GitMerge className="h-3.5 w-3.5" />
        Update to version…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-pin {selectedIds.size} parts to a version</DialogTitle>
            <DialogDescription>
              Pulls fresh metadata (mass, volume, bbox, thumbnail) from the
              chosen version. Operations and notes stay put.
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
            {versions.data?.map((v) => (
              <button
                key={v.id}
                disabled={bulkUpdate.isPending}
                onClick={() =>
                  bulkUpdate.mutate({
                    ids: [...selectedIds],
                    versionId: v.id,
                    versionName: v.name,
                  })
                }
                className="flex flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-left hover:border-primary/40 hover:bg-muted transition-colors"
              >
                <div className="font-medium text-sm">{v.name}</div>
                {v.createdAt && (
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {new Date(v.createdAt).toLocaleString()}
                  </div>
                )}
              </button>
            ))}
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

function FolderSidebar({
  selected,
  onSelect,
  folders,
  unassignedCount,
  totalCount,
}: {
  selected: FolderFilter;
  onSelect: (f: FolderFilter) => void;
  folders: Array<{
    folder: { id: string; name: string; description: string | null; color: string | null };
    partCount: number;
  }>;
  unassignedCount: number;
  totalCount: number;
}) {
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    description: string;
    color: string;
  } | null>(null);

  const create = trpc.folders.create.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      toast.success("Folder created");
      setCreating(false);
      setEditing(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const rename = trpc.folders.rename.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      toast.success("Folder updated");
      setEditing(null);
    },
  });
  const remove = trpc.folders.delete.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      utils.parts.list.invalidate();
      toast.success("Folder deleted; its parts are now unassigned.");
      onSelect("all");
    },
  });

  return (
    <Card className="self-start sticky top-4">
      <CardContent className="p-2 flex flex-col gap-1">
        <SidebarItem
          active={selected === "all"}
          onClick={() => onSelect("all")}
          icon={<FolderClosed className="h-3.5 w-3.5" />}
          label="All parts"
          count={totalCount}
        />
        <SidebarItem
          active={selected === "unassigned"}
          onClick={() => onSelect("unassigned")}
          icon={<Inbox className="h-3.5 w-3.5" />}
          label="Unassigned"
          count={unassignedCount}
        />
        <div className="my-1 -mx-2 h-px bg-border" />
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-1 flex items-center justify-between">
          Subsystems
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              setCreating(true);
              setEditing({ name: "", description: "", color: "" });
            }}
            title="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
        {folders.map(({ folder: f, partCount }) => (
          <div
            key={f.id}
            className={cn(
              "group flex items-center rounded-md text-sm transition-colors",
              typeof selected === "object" && selected.id === f.id
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted",
            )}
          >
            <button
              onClick={() => onSelect({ id: f.id })}
              className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left min-w-0"
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: f.color || "var(--muted-foreground)" }}
              />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                {Number(partCount)}
              </span>
            </button>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex pr-1">
              <button
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setCreating(false);
                  setEditing({
                    id: f.id,
                    name: f.name,
                    description: f.description ?? "",
                    color: f.color ?? "",
                  });
                }}
                title="Rename"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="p-1 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (
                    confirm(
                      `Delete folder "${f.name}"? Parts inside will become unassigned.`,
                    )
                  ) {
                    remove.mutate({ id: f.id });
                  }
                }}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        {folders.length === 0 && (
          <div className="text-[11px] text-muted-foreground/80 px-2 py-1.5">
            No folders yet. Create one to group parts by subsystem.
          </div>
        )}
      </CardContent>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {creating ? "New folder" : "Edit folder"}
            </DialogTitle>
            <DialogDescription>
              Group parts by subsystem (drivetrain, intake, arm, etc.)
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                placeholder="Drivetrain"
                value={editing?.name ?? ""}
                onChange={(e) =>
                  setEditing((s) => (s ? { ...s, name: e.target.value } : s))
                }
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="folder-color">Accent color (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="folder-color"
                  type="color"
                  value={editing?.color || "#9ca3af"}
                  onChange={(e) =>
                    setEditing((s) =>
                      s ? { ...s, color: e.target.value } : s,
                    )
                  }
                  className="h-9 w-16 p-1"
                />
                <span className="text-xs text-muted-foreground font-mono">
                  {editing?.color || "—"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="folder-desc">Description (optional)</Label>
              <Textarea
                id="folder-desc"
                placeholder="Notes about this subsystem…"
                value={editing?.description ?? ""}
                onChange={(e) =>
                  setEditing((s) =>
                    s ? { ...s, description: e.target.value } : s,
                  )
                }
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setCreating(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editing?.name.trim()) return;
                if (creating) {
                  create.mutate({
                    name: editing.name,
                    description: editing.description || undefined,
                    color: editing.color || undefined,
                  });
                } else if (editing.id) {
                  rename.mutate({
                    id: editing.id,
                    name: editing.name,
                    description: editing.description || undefined,
                    color: editing.color || undefined,
                  });
                }
              }}
              disabled={
                !editing?.name.trim() ||
                create.isPending ||
                rename.isPending
              }
            >
              {creating ? "Create folder" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SidebarItem({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted text-foreground/80",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
      <span className="ml-auto text-[10px] font-mono text-muted-foreground">
        {count}
      </span>
    </button>
  );
}
