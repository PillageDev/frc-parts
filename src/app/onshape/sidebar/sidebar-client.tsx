"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  KeyRound,
  Loader2,
  MousePointerClick,
  PackagePlus,
  Search,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { trpc } from "@/lib/trpc/client";
import { PartThumbnail } from "@/components/parts/part-thumbnail";
import { cn } from "@/lib/utils";
import {
  applicationInit,
  isStandalone,
  listenForMessages,
  readContextFromUrl,
  requestBodySelection,
  showMessageBubble,
  stopRequest,
  type OnshapeContext,
} from "./onshape-bridge";

type StockTypeKey = string;

// Onshape sets the iframe URL once and then reloads it when the active
// document changes, so there's no in-page subscription to manage. We
// memoize the parsed context at module scope: useSyncExternalStore would
// infinite-loop if getSnapshot returned a fresh object on every call.
const subscribe = () => () => {};
let memoizedCtx: OnshapeContext | null | undefined;
function getCtxSnapshot(): OnshapeContext | null {
  if (memoizedCtx === undefined) memoizedCtx = readContextFromUrl();
  return memoizedCtx;
}
const getCtxServerSnapshot = (): OnshapeContext | null => null;
// Primitive snapshots — no caching needed, identity-stable by definition.
const getClientFlag = () => true;
const getClientFlagServer = () => false;

export function SidebarApp() {
  const ctx = useSyncExternalStore(
    subscribe,
    getCtxSnapshot,
    getCtxServerSnapshot,
  );
  const isClient = useSyncExternalStore(
    subscribe,
    getClientFlag,
    getClientFlagServer,
  );

  // Announce to the host Onshape window. Onshape ignores any other messages
  // until it sees applicationInit, so do this as soon as we know the ctx.
  useEffect(() => {
    if (ctx) applicationInit(ctx);
  }, [ctx]);

  if (!isClient) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (!ctx) {
    return <NoContextState />;
  }

  return <SidebarShell ctx={ctx} />;
}

function NoContextState() {
  // Dump whatever query params the iframe DID arrive with — useful when
  // Onshape passes different names than we expect (e.g. `did` vs
  // `documentId`, or no params at all because the iframe was loaded via
  // the OAuth start URL instead of the extension Action URL).
  const seen =
    typeof window !== "undefined"
      ? Array.from(new URLSearchParams(window.location.search).entries())
      : [];
  return (
    <div className="flex h-full flex-col">
      <Header subtitle="not in Onshape" />
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
            <div className="space-y-2">
              <div className="font-medium">No Onshape context</div>
              <div className="text-muted-foreground leading-snug">
                This page is meant to load inside Onshape as an Element right
                panel extension. To set it up:
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-muted-foreground leading-snug">
                <li>
                  <a
                    className="underline"
                    href="https://dev-portal.onshape.com/oauthApps"
                    target="_blank"
                    rel="noreferrer"
                  >
                    dev-portal.onshape.com/oauthApps
                  </a>{" "}
                  → your app → <strong>Extensions</strong> → Add extension.
                </li>
                <li>
                  Location <strong>Element right panel</strong>, Context{" "}
                  <strong>Part Studio</strong>.
                </li>
                <li>
                  Action URL:{" "}
                  <code className="font-mono text-[11px]">{`${typeof window !== "undefined" ? window.location.origin : "https://YOUR_HOST"}/onshape/sidebar`}</code>
                </li>
              </ol>
              <div className="text-muted-foreground leading-snug">
                Reload an Onshape document — the panel shows up under the
                right-side icon strip.
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Query params received
          </div>
          {seen.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              (none — Onshape isn&apos;t passing context to this iframe)
            </div>
          ) : (
            <ul className="text-[11px] font-mono break-all space-y-0.5">
              {seen.map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted-foreground">{k}</span>={v}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          You can also append{" "}
          <code className="font-mono">
            ?documentId=…&amp;workspaceId=…&amp;elementId=…
          </code>{" "}
          to test locally.
        </div>
      </div>
    </div>
  );
}

function SidebarShell({ ctx }: { ctx: OnshapeContext }) {
  const status = trpc.parts.onshapeStatus.useQuery();
  // Pull the doc name to use as the header subtitle. Falls back to the
  // shortened ID while loading or if Onshape rejects the read.
  const docInfo = trpc.parts.onshapeDocumentInfo.useQuery(
    { documentId: ctx.documentId },
    {
      enabled: status.data?.connected !== false,
      retry: false,
      staleTime: 5 * 60_000,
    },
  );
  const subtitle = docInfo.data?.name ?? shortDocId(ctx.documentId);
  const [tab, setTab] = useState<"browse" | "upload">(
    ctx.elementId ? "upload" : "browse",
  );

  if (status.data && !status.data.connected) {
    return (
      <div className="flex h-full flex-col">
        <Header subtitle={shortDocId(ctx.documentId)} />
        <SetupGate />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header subtitle={subtitle} />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "browse" | "upload")}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-3 pt-2">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="upload" className="text-xs gap-1.5">
              <PackagePlus className="h-3.5 w-3.5" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="browse" className="text-xs gap-1.5">
              <Boxes className="h-3.5 w-3.5" />
              In manager
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="upload"
          className="flex-1 overflow-y-auto px-3 pb-4 mt-2"
        >
          <UploadWizard ctx={ctx} />
        </TabsContent>
        <TabsContent
          value="browse"
          className="flex-1 overflow-y-auto px-3 pb-4 mt-2"
        >
          <BrowseTab ctx={ctx} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <Wrench className="h-3.5 w-3.5" strokeWidth={2.4} />
      </div>
      <div className="flex flex-col leading-tight min-w-0 flex-1">
        <span className="font-serif font-semibold text-sm tracking-tight truncate">
          SpikeParts
        </span>
        <span
          className="text-[11px] text-muted-foreground truncate"
          title={subtitle}
        >
          {subtitle}
        </span>
      </div>
      <a
        href="/"
        target="_blank"
        rel="noreferrer"
        title="Open SpikeParts in a new tab"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function SetupGate() {
  return (
    <div className="flex-1 overflow-y-auto p-3 text-sm">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2 font-medium">
          <KeyRound className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          Connect Onshape API keys
        </div>
        <div className="text-muted-foreground leading-snug text-xs">
          The sidebar reads parts and thumbnails through the SpikeParts server,
          which signs requests with your Onshape API keys. Set these in{" "}
          <code className="font-mono">.env.local</code> and restart{" "}
          <code className="font-mono">pnpm dev</code>:
        </div>
        <pre className="rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed border border-border whitespace-pre-wrap">
          {`ONSHAPE_ACCESS_KEY=…
ONSHAPE_SECRET_KEY=…`}
        </pre>
        <a
          href="https://dev-portal.onshape.com/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs underline"
        >
          dev-portal.onshape.com/keys <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ─── Browse tab ───────────────────────────────────────────────────────────

function BrowseTab({ ctx }: { ctx: OnshapeContext }) {
  const parts = trpc.parts.byDocument.useQuery({ documentId: ctx.documentId });
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts.data ?? [];
    return (parts.data ?? []).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.partNumber.toLowerCase().includes(q) ||
        (p.material ?? "").toLowerCase().includes(q),
    );
  }, [parts.data, search]);

  if (parts.isPending) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if ((parts.data ?? []).length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
        No parts from this document yet. Use the <strong>Upload</strong> tab to
        send the first one over.
      </div>
    );
  }

  // Most-recent imported version among these parts — used as the
  // "currently pinned" hint in the version picker.
  const currentVersionId =
    parts.data?.find((p) => p.onshapeVersionId)?.onshapeVersionId ?? null;
  const allPartIds = (parts.data ?? []).map((p) => p.id);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter parts…"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {filtered.length} of {parts.data?.length} part
          {parts.data?.length === 1 ? "" : "s"}
        </div>
        <UpdateToVersionButton
          documentId={ctx.documentId}
          partIds={allPartIds}
          currentVersionId={currentVersionId}
        />
      </div>
      <div className="space-y-1.5">
        {filtered.map((p) => (
          <a
            key={p.id}
            href={`/parts/${p.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border border-border bg-card p-2 hover:bg-muted/40 transition-colors"
          >
            <div className="h-12 w-12 shrink-0">
              <PartThumbnail url={p.thumbnailUrl} alt={p.name} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{p.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground truncate">
                {p.partNumber}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge variant="muted" className="text-[9px] px-1.5 py-0">
                  {p.status.replace(/_/g, " ")}
                </Badge>
                {p.material && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {p.material}
                  </span>
                )}
                {p.onshapeVersionName && (
                  <span className="text-[9px] font-mono text-muted-foreground truncate">
                    {p.onshapeVersionName}
                  </span>
                )}
              </div>
            </div>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Re-pin every part in the current Onshape document to a chosen Version.
 * Mirrors the Bulk-update-to-version button on the main parts page; pulls
 * fresh mass/volume/bbox/thumbnail from the new version, leaves operations
 * and notes alone.
 */
function UpdateToVersionButton({
  documentId,
  partIds,
  currentVersionId,
}: {
  documentId: string;
  partIds: string[];
  currentVersionId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const versions = trpc.parts.documentVersions.useQuery(
    { documentId },
    { enabled: open, retry: false },
  );
  const bulk = trpc.parts.bulkUpdateToVersion.useMutation({
    onSuccess: (res) => {
      utils.parts.byDocument.invalidate();
      utils.parts.list.invalidate();
      if (res.failed > 0) {
        toast.warning(
          `Updated ${res.updated}; ${res.failed} failed. See console.`,
        );
        console.warn("Bulk version update errors:", res.errors);
      } else {
        toast.success(
          `Updated ${res.updated} part${res.updated === 1 ? "" : "s"}`,
        );
      }
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (partIds.length === 0) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-[11px]"
        onClick={() => setOpen(true)}
      >
        <GitMerge className="h-3 w-3" />
        Update to version…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Re-pin {partIds.length} part{partIds.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Pulls fresh mass / volume / bbox / thumbnail from the chosen
              version. Operations and notes stay put.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
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
                  disabled={bulk.isPending}
                  onClick={() =>
                    bulk.mutate({
                      ids: partIds,
                      versionId: v.id,
                      versionName: v.name,
                    })
                  }
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                    isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-medium text-sm flex-1 truncate">
                      {v.name}
                    </span>
                    {isCurrent && (
                      <Badge variant="muted" className="text-[9px]">
                        currently pinned
                      </Badge>
                    )}
                  </div>
                  {v.createdAt && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {new Date(v.createdAt).toLocaleString()}
                    </div>
                  )}
                  {v.description && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {v.description}
                    </div>
                  )}
                </button>
              );
            })}
            {versions.data?.length === 0 && (
              <div className="text-sm text-muted-foreground py-3 text-center">
                No versions in this document yet. Create one in Onshape
                (document menu → Versions and history → Create version).
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Upload wizard ────────────────────────────────────────────────────────

type WizardPart = {
  partId: string;
  name: string;
  partNumber?: string;
  material?: string | null;
  bodyType?: string;
};

type WizardConfig = {
  stockType: StockTypeKey;
  quantity: number;
};

function UploadWizard({ ctx }: { ctx: OnshapeContext }) {
  if (!ctx.elementId) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <div className="font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          Open a Part Studio
        </div>
        <div className="text-muted-foreground mt-1 text-xs leading-snug">
          The sidebar uploads parts from the active tab. Click into a Part
          Studio in this document and the wizard will list its parts.
        </div>
      </div>
    );
  }

  return <PickPartsStep ctx={ctx} elementId={ctx.elementId} />;
}

function PickPartsStep({
  ctx,
  elementId,
}: {
  ctx: OnshapeContext;
  elementId: string;
}) {
  const contents = trpc.parts.onshapeElementContents.useQuery(
    {
      documentId: ctx.documentId,
      workspaceId: ctx.workspaceId,
      versionId: ctx.versionId,
      elementId,
      elementType: "PARTSTUDIO",
    },
    { retry: false },
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"pick" | "configure">("pick");

  const allParts: WizardPart[] = useMemo(() => {
    if (contents.data?.kind !== "parts") return [];
    return contents.data.parts;
  }, [contents.data]);

  // Cross-check the listed parts against what's already in the manager.
  // Anything that comes back is "already imported" — re-import would
  // refresh metadata (mass/bbox/thumbnail) but rewrite the existing row.
  const partIdsForCheck = useMemo(
    () => allParts.map((p) => p.partId),
    [allParts],
  );
  const dupes = trpc.parts.checkDuplicates.useQuery(
    {
      documentId: ctx.documentId,
      elementId,
      partIds: partIdsForCheck,
    },
    { enabled: partIdsForCheck.length > 0, staleTime: 30_000 },
  );
  const duplicateMap = useMemo(() => {
    const m = new Map<
      string,
      { id: string; name: string; partNumber: string }
    >();
    for (const d of dupes.data ?? []) {
      if (d.onshapePartId) {
        m.set(d.onshapePartId, {
          id: d.id,
          name: d.name,
          partNumber: d.partNumber,
        });
      }
    }
    return m;
  }, [dupes.data]);

  // Wire up Onshape selection. Each REQUESTED_SELECTION carries the FULL
  // current viewer selection, so we diff against what the viewer had last
  // time and apply +adds / -removes to the sidebar's checked set. That way
  // deselecting in Onshape unchecks the matching row, while parts the user
  // had checked outside of pick mode stay put (we only touch IDs that were
  // ever in the viewer set).
  const messageIdRef = useRef<string | null>(null);
  const lastViewerSetRef = useRef<Set<string>>(new Set());
  const [pickingInViewer, setPickingInViewer] = useState(false);

  useEffect(() => {
    return listenForMessages(ctx, (msg) => {
      const ourId = messageIdRef.current;

      // STOPPED_REQUEST: Onshape acknowledges our stopRequest. End the
      // pick session if it pairs with the request we started.
      if (msg.messageName === "STOPPED_REQUEST") {
        const stoppedId = msg.stoppedRequestId ?? msg.stoppedMessageId;
        if (ourId && stoppedId === ourId) {
          setPickingInViewer(false);
          messageIdRef.current = null;
          lastViewerSetRef.current = new Set();
        }
        return;
      }

      // REQUESTED_SELECTION: streams the user's current selection. Fall
      // back to the docs' `SELECTION` name in case Onshape ever switches.
      if (
        msg.messageName !== "REQUESTED_SELECTION" &&
        msg.messageName !== "SELECTION"
      ) {
        return;
      }
      if (!ourId || msg.messageId !== ourId) return;

      // Resolve viewer selection IDs back to our part rows.
      const newViewerSet = new Set<string>();
      for (const s of msg.selections ?? []) {
        const candidate =
          s.selectionId ?? s.partId ?? s.deterministicId ?? undefined;
        if (!candidate) continue;
        const hit = allParts.find((p) => p.partId === candidate);
        if (hit) newViewerSet.add(hit.partId);
      }

      // Apply diff: anything that was in viewer last tick but isn't now
      // → uncheck. Anything new in viewer → check. Anything outside the
      // viewer set is left alone (preserves manual baseline).
      const oldViewerSet = lastViewerSetRef.current;
      lastViewerSetRef.current = newViewerSet;
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of oldViewerSet) {
          if (!newViewerSet.has(id)) next.delete(id);
        }
        for (const id of newViewerSet) {
          if (!oldViewerSet.has(id)) next.add(id);
        }
        return next;
      });

      // SUCCESS = Onshape auto-closed the pick session (only when
      // requiredSelectionCount > 0; we set 0 so this is rare).
      const statusValue =
        typeof msg.status === "object" && msg.status !== null
          ? msg.status.value
          : msg.status;
      if (statusValue === "SUCCESS") {
        setPickingInViewer(false);
        messageIdRef.current = null;
        lastViewerSetRef.current = new Set();
      }
    });
  }, [ctx, allParts]);

  function startViewerPick() {
    if (isStandalone()) {
      toast.info("Open this inside Onshape to pick parts in the 3D viewer.");
      return;
    }
    const id = `pick-${Date.now()}`;
    messageIdRef.current = id;
    lastViewerSetRef.current = new Set();
    setPickingInViewer(true);
    requestBodySelection(ctx, { messageId: id });
    toast.message("Click parts in the Onshape viewer", {
      description: "Click the button again when you're done.",
    });
  }

  function cancelViewerPick() {
    stopRequest(ctx);
    // Optimistically flip; the STOPPED message will also clear it.
    messageIdRef.current = null;
    lastViewerSetRef.current = new Set();
    setPickingInViewer(false);
  }

  function toggle(partId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allParts.map((p) => p.partId)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  if (contents.isPending) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading parts…
      </div>
    );
  }

  if (contents.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <div className="font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Couldn&apos;t read this Part Studio
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {contents.error.message}
        </div>
      </div>
    );
  }

  if (allParts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
        Onshape returned no importable solid parts in this Part Studio.
      </div>
    );
  }

  if (step === "configure") {
    const picks = allParts.filter((p) => selected.has(p.partId));
    return (
      <ConfigureStep
        ctx={ctx}
        elementId={elementId}
        picks={picks}
        duplicateMap={duplicateMap}
        onBack={() => setStep("pick")}
        onDone={() => {
          clearAll();
          setStep("pick");
        }}
      />
    );
  }

  const dupCount = allParts.reduce(
    (n, p) => (duplicateMap.has(p.partId) ? n + 1 : n),
    0,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {allParts.length} part{allParts.length === 1 ? "" : "s"} ·{" "}
          {selected.size} selected
          {dupCount > 0 && (
            <>
              {" "}· <span className="text-blue-600 dark:text-blue-400">{dupCount} already in manager</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            onClick={selectAll}
          >
            All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            onClick={clearAll}
          >
            None
          </Button>
        </div>
      </div>

      <Button
        variant={pickingInViewer ? "default" : "outline"}
        size="sm"
        className="w-full text-xs gap-1.5"
        onClick={pickingInViewer ? cancelViewerPick : startViewerPick}
        disabled={isStandalone()}
        title={
          isStandalone()
            ? "Available only when loaded inside Onshape"
            : "Click parts in the Onshape viewer to add them"
        }
      >
        <MousePointerClick className="h-3.5 w-3.5" />
        {pickingInViewer ? "Pick in viewer… (click to stop)" : "Pick in viewer"}
      </Button>

      <div className="space-y-1">
        {allParts.map((p) => {
          const checked = selected.has(p.partId);
          const dup = duplicateMap.get(p.partId);
          return (
            <label
              key={p.partId}
              className={cn(
                "flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors",
                checked
                  ? "border-primary/40 bg-primary/5"
                  : dup
                    ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                    : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(p.partId)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{p.name}</span>
                  {dup && (
                    <Badge
                      variant="muted"
                      className="text-[9px] px-1 py-0 h-4 shrink-0 bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300"
                    >
                      <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                      already in manager
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {p.partNumber || p.partId} · {p.material ?? "no material"}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <Button
        size="sm"
        className="w-full"
        disabled={selected.size === 0}
        onClick={() => setStep("configure")}
      >
        Configure {selected.size || ""} →
      </Button>
    </div>
  );
}

function ConfigureStep({
  ctx,
  elementId,
  picks,
  duplicateMap,
  onBack,
  onDone,
}: {
  ctx: OnshapeContext;
  elementId: string;
  picks: WizardPart[];
  duplicateMap: Map<string, { id: string; name: string; partNumber: string }>;
  onBack: () => void;
  onDone: () => void;
}) {
  const dupedPicks = picks.filter((p) => duplicateMap.has(p.partId));
  const [confirmingDupes, setConfirmingDupes] = useState(false);
  // Onshape import is gated to a named Version. If the user is browsing on
  // a workspace, we surface the version picker so they can pin the import.
  const needsVersion = !ctx.versionId;
  const versions = trpc.parts.documentVersions.useQuery(
    { documentId: ctx.documentId },
    { enabled: needsVersion, retry: false },
  );
  // Derive: ctx-pinned version wins, then anything the user picked,
  // then the most recent fetched version. No effect needed.
  const [userPickedVersionId, setUserPickedVersionId] = useState<string | null>(
    null,
  );
  const chosenVersionId =
    ctx.versionId ?? userPickedVersionId ?? versions.data?.[0]?.id ?? null;
  const setChosenVersionId = (v: string) => setUserPickedVersionId(v);

  const [config, setConfig] = useState<Record<string, WizardConfig>>(() => {
    const init: Record<string, WizardConfig> = {};
    for (const p of picks) {
      init[p.partId] = { stockType: "auto", quantity: 1 };
    }
    return init;
  });

  const utils = trpc.useUtils();
  const importPart = trpc.parts.importPart.useMutation();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{
    ok: number;
    fail: Array<{ name: string; error: string }>;
  } | null>(null);

  function attemptImport() {
    if (!chosenVersionId) {
      toast.error("Pick a version to pin the import to first.");
      return;
    }
    if (dupedPicks.length > 0) {
      // Hold off; surface the confirm dialog first.
      setConfirmingDupes(true);
      return;
    }
    void runImport();
  }

  async function runImport() {
    if (!chosenVersionId) {
      toast.error("Pick a version to pin the import to first.");
      return;
    }
    setConfirmingDupes(false);
    setRunning(true);
    setResults(null);
    let ok = 0;
    const fail: Array<{ name: string; error: string }> = [];
    for (const p of picks) {
      const cfg = config[p.partId];
      try {
        await importPart.mutateAsync({
          documentId: ctx.documentId,
          versionId: chosenVersionId,
          elementId,
          partId: p.partId,
          type: "custom",
          stockType: cfg.stockType,
          quantity: cfg.quantity,
        });
        ok++;
      } catch (e) {
        fail.push({ name: p.name, error: (e as Error).message });
      }
    }
    setResults({ ok, fail });
    setRunning(false);
    utils.parts.byDocument.invalidate();
    utils.parts.list.invalidate();
    utils.parts.checkDuplicates.invalidate();
    if (ok > 0) {
      showMessageBubble(
        ctx,
        `SpikeParts: imported ${ok} part${ok === 1 ? "" : "s"}`,
      );
    }
  }

  if (results) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Imported {results.ok} part{results.ok === 1 ? "" : "s"}
          </div>
          {results.fail.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              {results.fail.length} skipped
            </div>
          )}
        </div>
        {results.fail.length > 0 && (
          <div className="space-y-1">
            {results.fail.map((f) => (
              <div
                key={f.name}
                className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs"
              >
                <div className="font-medium">{f.name}</div>
                <div className="text-muted-foreground">{f.error}</div>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="h-7 px-2 text-xs gap-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Button>

      {needsVersion && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 space-y-2">
          <div className="flex items-start gap-2 text-xs">
            <GitMerge className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
            <div className="space-y-1">
              <div className="font-medium">Pin to a Version</div>
              <div className="text-muted-foreground leading-snug">
                You&apos;re viewing a workspace. SpikeParts only imports from
                named Versions so every part traces to an immutable revision.
                Pick one — or create a new one in Onshape ({" "}
                <em>doc menu → Versions and history → Create version</em>) and
                refresh.
              </div>
            </div>
          </div>
          {versions.isPending && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading versions…
            </div>
          )}
          {versions.data && versions.data.length === 0 && (
            <div className="text-[11px] text-muted-foreground">
              No versions yet — create one in Onshape and refresh the panel.
            </div>
          )}
          {versions.data && versions.data.length > 0 && (
            <Select
              value={chosenVersionId ?? undefined}
              onValueChange={(v) => setChosenVersionId(v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Pick a version" />
              </SelectTrigger>
              <SelectContent>
                {versions.data.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <div className="space-y-2">
        {picks.map((p) => (
          <ConfigureRow
            key={p.partId}
            part={p}
            config={config[p.partId]}
            onChange={(cfg) =>
              setConfig((prev) => ({ ...prev, [p.partId]: cfg }))
            }
          />
        ))}
      </div>

      {dupedPicks.length > 0 && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {dupedPicks.length} of {picks.length} already in manager
          </div>
          <div className="text-muted-foreground leading-snug">
            Re-importing refreshes mass / volume / bbox / thumbnail and bumps
            the version pin. Operations and notes stay put.
          </div>
        </div>
      )}

      <Button
        size="sm"
        className="w-full"
        onClick={attemptImport}
        disabled={running || !chosenVersionId}
      >
        {running ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Importing…
          </span>
        ) : dupedPicks.length === picks.length ? (
          `Re-import ${picks.length} part${picks.length === 1 ? "" : "s"}`
        ) : dupedPicks.length > 0 ? (
          `Import ${picks.length} (${dupedPicks.length} will update)`
        ) : (
          `Import ${picks.length} part${picks.length === 1 ? "" : "s"}`
        )}
      </Button>

      <Dialog open={confirmingDupes} onOpenChange={setConfirmingDupes}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Re-import {dupedPicks.length} part
              {dupedPicks.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              These are already in the manager. Re-importing will refresh
              their metadata from the chosen Onshape version. Operations,
              notes, and attachments stay put.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[40vh] overflow-y-auto space-y-1">
            {dupedPicks.map((p) => {
              const dup = duplicateMap.get(p.partId);
              return (
                <div
                  key={p.partId}
                  className="rounded-md border border-border bg-muted/30 p-2 text-xs"
                >
                  <div className="font-medium truncate">{p.name}</div>
                  {dup && (
                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                      manager: {dup.partNumber}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDupes(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={runImport}>
              Re-import
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfigureRow({
  part,
  config,
  onChange,
}: {
  part: WizardPart;
  config: WizardConfig;
  onChange: (cfg: WizardConfig) => void;
}) {
  const templates = trpc.templates.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  return (
    <div className="rounded-md border border-border bg-card p-2 space-y-1.5">
      <div className="text-xs font-medium truncate">{part.name}</div>
      <div className="text-[10px] text-muted-foreground font-mono truncate">
        {part.partNumber || part.partId} · {part.material ?? "no material"}
      </div>
      <div className="flex items-center gap-1.5">
        <Select
          value={config.stockType}
          onValueChange={(v) => onChange({ ...config, stockType: v })}
        >
          <SelectTrigger className="h-7 text-[11px] flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            {(templates.data ?? []).map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1}
          step={1}
          value={config.quantity}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({
              ...config,
              quantity: Number.isFinite(n) && n > 0 ? n : 1,
            });
          }}
          className="h-7 w-12 text-center text-[11px]"
          aria-label="quantity"
        />
      </div>
    </div>
  );
}

function shortDocId(id: string) {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
