"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
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
        <p className="text-muted-foreground mt-1">
          Pulls part name, material, mass, volume, bounding box, and thumbnail
          live from Onshape. Auto-routes custom parts to a machine queue.
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
              request is signed with HMAC-SHA256 — your secret never leaves the
              server.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ol className="list-decimal pl-5 flex flex-col gap-2 leading-relaxed">
          <li>
            Open the{" "}
            <a
              href="https://dev-portal.onshape.com/keys"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Onshape Developer Portal — API Keys
            </a>{" "}
            and click <strong>Create new API key</strong>.
          </li>
          <li>
            Pick the scopes:
            <ul className="list-disc pl-6 mt-1">
              <li>
                <code className="font-mono text-xs">OAuth2Read</code> — read
                documents, elements, parts
              </li>
              <li>
                <code className="font-mono text-xs">OAuth2ReadPII</code>{" "}
                <span className="text-muted-foreground">
                  (optional — owner names)
                </span>
              </li>
            </ul>
          </li>
          <li>
            Copy the <strong>Access Key</strong> and <strong>Secret Key</strong>{" "}
            (Onshape only shows the secret once).
          </li>
          <li>
            Paste them into{" "}
            <code className="font-mono text-xs">.env.local</code> in the project
            root:
            <pre className="mt-2 rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed border border-border whitespace-pre-wrap">
{`ONSHAPE_ACCESS_KEY=your-access-key
ONSHAPE_SECRET_KEY=your-secret-key
# optional, defaults to https://cad.onshape.com
# ONSHAPE_BASE_URL=https://cad.onshape.com`}
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
          Documents you import must be readable by the account that owns the
          API key — share them in Onshape if needed.
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
            Paste an Onshape link
          </CardTitle>
          <CardDescription>
            Paste a URL pointing at a Part Studio, Assembly, or whole document.
            We&apos;ll list elements and parts so you can choose what to import.
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
              placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
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
          ref_={resolved.data.ref}
          elements={resolved.data.elements}
        />
      )}
    </div>
  );
}

function ResolvedView({
  ref_,
  elements,
}: {
  ref_: {
    documentId: string;
    workspaceId?: string;
    versionId?: string;
    elementId?: string;
  };
  elements: Array<{ id: string; name: string; elementType: string }>;
}) {
  const utils = trpc.useUtils();

  const initial =
    (ref_.elementId &&
      elements.find((e) => e.id === ref_.elementId)?.id) ||
    elements.find((e) => e.elementType === "PARTSTUDIO")?.id ||
    elements[0]?.id;

  const [selectedElementId, setSelectedElementId] = useState<string | undefined>(
    initial,
  );
  useEffect(() => {
    setSelectedElementId(initial);
  }, [initial]);

  const selectedElement = useMemo(
    () => elements.find((e) => e.id === selectedElementId),
    [elements, selectedElementId],
  );
  const partStudios = elements.filter((e) => e.elementType === "PARTSTUDIO");

  const importable = selectedElement?.elementType === "PARTSTUDIO";

  const contents = trpc.parts.onshapeElementContents.useQuery(
    {
      documentId: ref_.documentId,
      workspaceId: ref_.workspaceId,
      versionId: ref_.versionId,
      elementId: selectedElementId ?? "",
      elementType: "PARTSTUDIO",
    },
    {
      enabled: Boolean(selectedElementId) && importable,
      retry: false,
    },
  );

  const importPart = trpc.parts.importPart.useMutation({
    onSuccess: () => {
      utils.parts.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Part imported and routed");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Hash className="h-3.5 w-3.5" />
            Document elements
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {elements.map((el) => {
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
          {elements.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No part studios in this document.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {selectedElement?.elementType === "PARTSTUDIO" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PackageCheck className="h-4 w-4" />
                Parts in {selectedElement.name}
              </CardTitle>
              <CardDescription>
                Pick the stock type and (optional) drawing per part. Parts with
                the &quot;Origin Cube Material&quot; placeholder are hidden.
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
                    onImport={(opts) =>
                      importPart.mutate({
                        documentId: ref_.documentId,
                        workspaceId: ref_.workspaceId,
                        versionId: ref_.versionId,
                        elementId: selectedElement.id,
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
              {contents.data?.kind === "parts" &&
                contents.data.parts.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">
                    Onshape returned no importable parts in this Part Studio.
                    If you expected parts, check that they&apos;re solid bodies
                    in the active workspace and the API key has access to this
                    document.
                  </div>
                )}
              {contents.error && (
                <div className="text-sm text-destructive py-2">
                  {contents.error.message}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {selectedElement?.elementType !== "PARTSTUDIO" && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Pick a Part Studio on the left to import parts from.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Onshape connected · {partStudios.length} part studio
              {partStudios.length === 1 ? "" : "s"}
            </div>
            <a
              href={`https://cad.onshape.com/documents/${ref_.documentId}/${
                ref_.workspaceId ? `w/${ref_.workspaceId}` : `v/${ref_.versionId}`
              }`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              Open document in Onshape
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PartImportRow({
  part,
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
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3 flex-wrap">
      <div className="flex-1 min-w-[180px]">
        <div className="font-medium truncate">{part.name}</div>
        <div className="text-[11px] text-muted-foreground font-mono truncate">
          {part.partNumber || part.partId} ·{" "}
          {part.material ?? "no material set"}
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
        onClick={() =>
          onImport({
            stockType,
            quantity,
            drawing: drawing ?? undefined,
          })
        }
        disabled={isPending || reading}
      >
        Import
      </Button>
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
