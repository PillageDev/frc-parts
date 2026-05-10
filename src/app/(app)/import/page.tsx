"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  Hash,
  KeyRound,
  Loader2,
  PackageCheck,
  Paperclip,
  Search,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { trpc } from "@/lib/trpc/client";
import type { StockType } from "@/lib/db/schema";
import { toast } from "sonner";

type DrawingFile = {
  fileName: string;
  fileKind: "pdf" | "dxf" | "svg" | "step" | "stl" | "other";
  sizeBytes: number;
  url: string;
};

export default function ImportPage() {
  const status = trpc.parts.onshapeStatus.useQuery();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Import from Onshape
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Imports are gated on Onshape <strong>Versions</strong>. Create a
          named Version in Onshape (Document → Versions/History → Create
          Version), then bring its parts into SpikeParts. Live workspace
          imports are disabled — every part on the floor must trace to an
          immutable revision.
        </p>
      </div>

      {!status.data?.connected ? <SetupGuide /> : <ImportFlow />}
    </div>
  );
}

function SetupGuide() {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <div className="flex items-start gap-3">
          <KeyRound className="h-5 w-5 text-amber-700 dark:text-amber-300 mt-0.5" />
          <div className="flex-1">
            <CardTitle>Connect your Onshape account</CardTitle>
            <CardDescription className="mt-1">
              SpikeParts authenticates against Onshape using API keys. Each
              request is signed with HMAC-SHA256 — your secret never leaves
              the server.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ol className="list-decimal pl-5 flex flex-col gap-2 leading-relaxed">
          <li>
            Get keys at{" "}
            <a
              href="https://dev-portal.onshape.com/keys"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              dev-portal.onshape.com/keys
            </a>{" "}
            — pick scope <code className="font-mono text-xs">OAuth2Read</code>.
          </li>
          <li>
            Paste them into <code className="font-mono text-xs">.env.local</code>:
            <pre className="mt-2 rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed border border-border whitespace-pre-wrap">
{`ONSHAPE_ACCESS_KEY=…
ONSHAPE_SECRET_KEY=…`}
            </pre>
          </li>
          <li>
            Restart <code className="font-mono text-xs">pnpm dev</code> and
            reload this page.
          </li>
        </ol>
        <Separator />
        <p className="text-muted-foreground">
          The signing implementation lives at{" "}
          <code className="font-mono text-xs">src/lib/onshape/client.ts</code>.
        </p>
      </CardContent>
    </Card>
  );
}

function ImportFlow() {
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const resolved = trpc.parts.resolveOnshapeUrl.useQuery(
    { url: submitted ?? "" },
    { enabled: Boolean(submitted), retry: false },
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Paste an Onshape document link
          </CardTitle>
          <CardDescription>
            Anywhere in the document is fine — we just read the document ID.
            Once resolved, you&apos;ll pick which Version to import from.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(url.trim());
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://cad.onshape.com/documents/…"
              className="font-mono text-xs"
            />
            <Button type="submit" disabled={!url.trim()}>
              Resolve
            </Button>
          </form>
        </CardContent>
      </Card>

      {resolved.isFetching && (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Talking to Onshape…
          </CardContent>
        </Card>
      )}

      {resolved.error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 flex items-start gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not load this URL</div>
              <div className="text-muted-foreground">
                {resolved.error.message}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {resolved.data && (
        <ResolvedView
          documentId={resolved.data.ref.documentId}
          versions={resolved.data.versions}
        />
      )}
    </div>
  );
}

function ResolvedView({
  documentId,
  versions,
}: {
  documentId: string;
  versions: Array<{
    id: string;
    name: string;
    description?: string;
    createdAt?: string;
    microversion?: string;
  }>;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    versions[0]?.id ?? null,
  );
  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  const elements = trpc.parts.listVersionElements.useQuery(
    {
      documentId,
      versionId: selectedVersionId ?? "",
    },
    {
      enabled: Boolean(selectedVersionId),
      retry: false,
    },
  );

  // Derived: user pick wins, else first available element. Avoids the
  // setState-in-effect anti-pattern (lint: react-hooks/set-state-in-effect).
  const [userSelectedElementId, setUserSelectedElementId] = useState<
    string | null
  >(null);
  const selectedElementId =
    (userSelectedElementId &&
      elements.data?.find((e) => e.id === userSelectedElementId)?.id) ||
    elements.data?.[0]?.id ||
    null;
  const setSelectedElementId = (id: string | null) =>
    setUserSelectedElementId(id);

  if (versions.length === 0) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-5 flex items-start gap-3 text-sm">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300 mt-0.5" />
          <div>
            <div className="font-medium">
              No released Versions in this document yet
            </div>
            <div className="text-muted-foreground mt-1">
              Open the document in Onshape, click the document name →{" "}
              <strong>Versions and history</strong> → <strong>Create version</strong>,
              then come back here.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_280px_1fr] gap-3">
      {/* Versions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitMerge className="h-3.5 w-3.5" />
            Versions
          </CardTitle>
          <CardDescription className="text-[11px]">
            Pick which release to import from.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {versions.map((v) => {
            const active = v.id === selectedVersionId;
            return (
              <button
                key={v.id}
                onClick={() => {
                  setSelectedVersionId(v.id);
                  setSelectedElementId(null);
                }}
                className={
                  "flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
                  (active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted")
                }
              >
                <span className="truncate font-medium">{v.name}</span>
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
        </CardContent>
      </Card>

      {/* Elements within selected version */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Hash className="h-3.5 w-3.5" />
            Part studios
          </CardTitle>
          <CardDescription className="text-[11px]">
            {selectedVersion ? selectedVersion.name : "Pick a version first"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {elements.isFetching && (
            <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reading elements…
            </div>
          )}
          {elements.data?.map((el) => {
            const active = el.id === selectedElementId;
            return (
              <button
                key={el.id}
                onClick={() => setSelectedElementId(el.id)}
                className={
                  "flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
                  (active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted")
                }
              >
                <span className="truncate">{el.name}</span>
                <Badge variant="muted" className="text-[10px]">
                  {el.elementType.toLowerCase()}
                </Badge>
              </button>
            );
          })}
          {elements.data?.length === 0 && (
            <div className="text-xs text-muted-foreground py-2">
              No part studios in this version.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parts within selected element */}
      <PartsPanel
        documentId={documentId}
        versionId={selectedVersionId}
        versionName={selectedVersion?.name ?? ""}
        elementId={selectedElementId}
      />
    </div>
  );
}

function PartsPanel({
  documentId,
  versionId,
  versionName,
  elementId,
}: {
  documentId: string;
  versionId: string | null;
  versionName: string;
  elementId: string | null;
}) {
  const utils = trpc.useUtils();
  const contents = trpc.parts.onshapeElementContents.useQuery(
    {
      documentId,
      versionId: versionId ?? "",
      elementId: elementId ?? "",
      elementType: "PARTSTUDIO",
    },
    {
      enabled: Boolean(versionId && elementId),
      retry: false,
    },
  );
  const partIdsForCheck = useMemo(
    () =>
      contents.data?.kind === "parts"
        ? contents.data.parts.map((p) => p.partId)
        : [],
    [contents.data],
  );
  const dupes = trpc.parts.checkDuplicates.useQuery(
    {
      documentId,
      elementId: elementId ?? "",
      partIds: partIdsForCheck,
    },
    {
      enabled: Boolean(elementId) && partIdsForCheck.length > 0,
      staleTime: 30_000,
    },
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
  const importPart = trpc.parts.importPart.useMutation({
    onSuccess: () => {
      utils.parts.list.invalidate();
      utils.parts.checkDuplicates.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Part imported and routed");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!versionId || !elementId) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Pick a version and a part studio on the left.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <PackageCheck className="h-4 w-4" />
          Parts in version {versionName}
        </CardTitle>
        <CardDescription>
          Pick the stock type and (optional) drawing per part. Imported parts
          are pinned to this version, not the live workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {contents.isFetching && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading parts…
          </div>
        )}
        {contents.data?.kind === "parts" &&
          contents.data.parts.map((p) => (
            <PartImportRow
              key={p.partId}
              part={p}
              duplicate={duplicateMap.get(p.partId) ?? null}
              onImport={(opts) =>
                importPart.mutate({
                  documentId,
                  versionId,
                  versionName,
                  elementId,
                  partId: p.partId,
                  type: "custom",
                  stockType: opts.stockType,
                  quantity: opts.quantity,
                  drawing: opts.drawing,
                })
              }
              isPending={importPart.isPending}
            />
          ))}
        {contents.data?.kind === "parts" && contents.data.parts.length === 0 && (
          <div className="text-sm text-muted-foreground py-2">
            Onshape returned no importable parts. Check that the part studio
            has solid bodies and the API key has read access.
          </div>
        )}
        {contents.error && (
          <div className="text-sm text-destructive py-2">
            {contents.error.message}
          </div>
        )}

        <Separator className="my-2" />
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Importing from version{" "}
            <span className="font-mono">{versionName}</span> ·{" "}
            <span className="font-mono">{versionId.slice(0, 8)}…</span>
          </div>
          <a
            href={`https://cad.onshape.com/documents/${documentId}/v/${versionId}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Open in Onshape
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function PartImportRow({
  part,
  duplicate,
  onImport,
  isPending,
}: {
  part: {
    partId: string;
    name: string;
    partNumber?: string;
    material?: string | null;
    bodyType?: string;
  };
  /** Existing manager record if this Onshape part has already been imported. */
  duplicate: { id: string; name: string; partNumber: string } | null;
  onImport: (opts: {
    stockType: StockType;
    quantity: number;
    drawing?: DrawingFile;
  }) => void;
  isPending: boolean;
}) {
  const [stockType, setStockType] = useState<StockType>("auto");
  const [quantity, setQuantity] = useState<number>(1);
  const [drawing, setDrawing] = useState<DrawingFile | null>(null);
  const [reading, setReading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function attemptImport() {
    if (duplicate) {
      setConfirmOpen(true);
      return;
    }
    onImport({ stockType, quantity, drawing: drawing ?? undefined });
  }
  function confirmReimport() {
    setConfirmOpen(false);
    onImport({ stockType, quantity, drawing: drawing ?? undefined });
  }

  async function pickDrawing(file: File) {
    setReading(true);
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const fileKind: DrawingFile["fileKind"] =
      ext === "pdf" || ext === "dxf" || ext === "svg" || ext === "step" || ext === "stl"
        ? (ext as DrawingFile["fileKind"])
        : "other";
    const reader = new FileReader();
    const url = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    setDrawing({
      fileName: file.name,
      fileKind,
      sizeBytes: file.size,
      url,
    });
    setReading(false);
  }

  return (
    <div
      className={
        "flex items-center gap-3 rounded-md border p-3 flex-wrap " +
        (duplicate
          ? "border-blue-500/30 bg-blue-500/5"
          : "border-border bg-card")
      }
    >
      <div className="flex-1 min-w-[180px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{part.name}</span>
          {duplicate && (
            <Badge
              variant="muted"
              className="text-[10px] bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              already in manager
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground font-mono truncate">
          {part.partNumber || part.partId} ·{" "}
          {part.material ?? "no material set"}
          {duplicate && (
            <>
              {" · "}stored as <span className="text-foreground/70">{duplicate.partNumber}</span>
            </>
          )}
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        Qty
        <Input
          type="number"
          min={1}
          step={1}
          value={quantity}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            setQuantity(Number.isFinite(n) && n > 0 ? n : 1);
          }}
          className="h-8 w-16 text-center"
        />
      </label>
      <StockTypeSelect value={stockType} onChange={setStockType} />
      <label
        className={
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs cursor-pointer hover:bg-accent transition-colors " +
          (drawing ? "ring-1 ring-primary/40" : "")
        }
      >
        <Paperclip className="h-3.5 w-3.5" />
        {drawing ? (
          <span className="max-w-[140px] truncate">{drawing.fileName}</span>
        ) : reading ? (
          "Reading…"
        ) : (
          "Drawing"
        )}
        <input
          type="file"
          className="hidden"
          accept=".pdf,.dxf,.svg,.step,.stl"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickDrawing(f);
            e.target.value = "";
          }}
        />
      </label>
      {drawing && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setDrawing(null)}
          aria-label="Remove drawing"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        size="sm"
        variant={duplicate ? "outline" : "default"}
        onClick={attemptImport}
        disabled={isPending || reading}
      >
        {duplicate ? "Re-import" : "Import"}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-import {part.name}?</DialogTitle>
            <DialogDescription>
              This part is already in the manager
              {duplicate && (
                <>
                  {" "}as <span className="font-mono">{duplicate.partNumber}</span>
                </>
              )}
              . Re-importing refreshes mass / volume / bbox / thumbnail and
              bumps the version pin. Operations, notes, and attachments stay
              put.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmReimport}>Re-import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StockTypeSelect({
  value,
  onChange,
}: {
  value: StockType;
  onChange: (v: StockType) => void;
}) {
  const templates = trpc.templates.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StockType)}>
      <SelectTrigger className="w-[200px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto-detect</SelectItem>
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
