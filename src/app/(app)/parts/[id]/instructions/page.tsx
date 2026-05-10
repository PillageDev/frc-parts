"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Loader2,
  Wrench,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { PartThumbnail } from "@/components/parts/part-thumbnail";
import { machineKindLabel, priorityLabel } from "@/lib/labels";
import { toast } from "sonner";

const MM_TO_IN = 1 / 25.4;
const G_TO_OZ = 0.035274;

function formatInches(mm: number, precision = 3) {
  return `${(mm * MM_TO_IN).toFixed(precision)}"`;
}
function formatBoxInches(x: number, y: number, z: number) {
  return `${(x * MM_TO_IN).toFixed(2)} × ${(y * MM_TO_IN).toFixed(2)} × ${(z * MM_TO_IN).toFixed(2)} in`;
}
function formatWeight(grams: number) {
  const oz = grams * G_TO_OZ;
  if (oz >= 16) return `${(oz / 16).toFixed(2)} lb`;
  return `${oz.toFixed(2)} oz`;
}

const QC_QUICK = [
  "Dimensions match drawing",
  "Material correct",
  "Threads check (if any)",
  "No burrs / surface defects",
];

export default function InstructionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const part = trpc.parts.byId.useQuery({ id });
  const travelerRef = useRef<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);

  if (part.isLoading || !part.data) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const p = part.data;

  async function exportPdf() {
    if (!travelerRef.current) return;
    setExporting(true);
    try {
      // Lazy-load both libs so they stay out of the initial bundle.
      const [{ jsPDF }, html2canvasMod] = await Promise.all([
        import("jspdf"),
        import("html2canvas-pro"),
      ]);
      const html2canvas = html2canvasMod.default;

      const el = travelerRef.current;
      // Wait for any pending image loads in the traveler so they show up.
      const imgs = Array.from(el.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalHeight > 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
                // Failsafe: don't hang forever on a slow proxy.
                setTimeout(resolve, 4000);
              }),
        ),
      );

      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        imageTimeout: 5000,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");

      const pageWidth = 297; // mm — A4 width
      const pageHeight = (canvas.height / canvas.width) * pageWidth;
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: [pageWidth, pageHeight],
        compress: true,
      });
      pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);

      const safeName = p.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/_+$/, "");
      pdf.save(`${p.partNumber}-${safeName}.pdf`);
      toast.success("PDF exported");
    } catch (err) {
      console.error(err);
      toast.error(`Could not export: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }
  const generatedAt = new Date();

  const stockSize =
    p.bboxXMm != null && p.bboxYMm != null && p.bboxZMm != null
      ? formatBoxInches(p.bboxXMm, p.bboxYMm, p.bboxZMm)
      : "—";

  return (
    <div className="instructions-doc flex flex-col gap-4 max-w-[1180px] mx-auto">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/parts/${p.id}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to part
        </Link>
        <Button onClick={exportPdf} disabled={exporting}>
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {exporting ? "Generating PDF…" : "Export PDF"}
        </Button>
      </div>

      <article
        ref={travelerRef}
        className="traveler bg-white text-neutral-900 mx-auto border-2 border-neutral-900 print:border-0 grid grid-rows-[auto_1fr_auto]"
      >
        {/* ── TITLE BLOCK ─────────────────────────────────────────────── */}
        <header className="grid grid-cols-[1fr_auto_auto_auto_auto] items-stretch border-b-2 border-neutral-900">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex h-7 w-7 items-center justify-center bg-neutral-900 text-white">
              <Wrench className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[8px] uppercase tracking-[0.2em] text-neutral-500">
                SpikeParts
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-700">
                Shop Traveler
              </span>
            </div>
          </div>
          <TitleBlock label="Part No.">
            <span className="font-mono text-sm">{p.partNumber}</span>
          </TitleBlock>
          <TitleBlock label="Qty">
            <span className="font-mono text-sm font-bold">×{p.quantity}</span>
          </TitleBlock>
          <TitleBlock label="Date">
            <span className="font-mono text-[11px]">
              {generatedAt.toISOString().slice(0, 10)}
            </span>
          </TitleBlock>
          {p.onshapeUrl ? (
            <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 border-l-2 border-neutral-900">
              <QRCodeSVG
                value={p.onshapeUrl}
                size={56}
                level="M"
                marginSize={0}
                bgColor="#ffffff"
                fgColor="#171717"
              />
              <span className="text-[7px] uppercase tracking-[0.2em] text-neutral-500">
                Scan → CAD
              </span>
            </div>
          ) : null}
        </header>

        {/* ── MAIN: image + spec block ───────────────────────────────── */}
        <section className="grid grid-cols-[44%_1fr] divide-x-2 divide-neutral-900">
          <div className="flex flex-col">
            <div className="grow flex items-center justify-center bg-neutral-50 border-b-2 border-neutral-900 p-2 min-h-0">
              <PartThumbnail
                url={p.thumbnailUrl}
                alt={p.name}
                className="aspect-square h-full max-h-full w-auto border-0 bg-transparent"
              />
            </div>
            <div className="px-4 py-2 flex items-baseline justify-between gap-3">
              <h1 className="font-serif text-2xl tracking-tight leading-tight">
                {p.name}
              </h1>
              {p.assembly && (
                <span className="text-[10px] uppercase tracking-[0.15em] text-neutral-500">
                  {p.assembly.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col">
            {/* Technical spec rows */}
            <dl className="grid grid-cols-2">
              <SpecRow label="Material" value={p.material ?? "—"} mono />
              <SpecRow
                label="Stock size"
                value={stockSize}
                mono
                rightBorder={false}
              />
              <SpecRow
                label="Mass"
                value={
                  p.massGrams != null ? formatWeight(p.massGrams) : "—"
                }
                mono
                rightBorder={false}
              />
              <SpecRow
                label="Priority"
                value={priorityLabel[p.priority].toUpperCase()}
                emphasis={p.priority === "blocking" || p.priority === "high"}
              />
              <SpecRow
                label="Subsystem"
                value={p.folder?.name ?? "—"}
                rightBorder={false}
              />
            </dl>

            {/* Process table */}
            <div className="grow flex flex-col border-t-2 border-neutral-900 min-h-0">
              <div className="px-3 py-1.5 bg-neutral-900 text-white text-[10px] uppercase tracking-[0.2em]">
                Process
              </div>
              {p.type === "cots" ? (
                <div className="px-4 py-3 text-xs text-neutral-600">
                  COTS — purchased, no manufacturing required.
                </div>
              ) : p.operations.length === 0 ? (
                <div className="px-4 py-3 text-xs text-neutral-600">
                  No operations defined.
                </div>
              ) : (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-neutral-300 bg-neutral-100">
                      <Th className="w-8 text-center">#</Th>
                      <Th>Operation</Th>
                      <Th>Machine</Th>
                      <Th className="w-12 text-center">Done</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.operations.map((op, i) => (
                      <tr
                        key={op.id}
                        className="border-b border-neutral-200 last:border-b-0"
                      >
                        <td className="px-2 py-1.5 text-center font-mono text-[10px] text-neutral-500">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{op.name}</div>
                          {op.notes && (
                            <div className="text-[10px] text-neutral-600 mt-0.5">
                              {op.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-neutral-700">
                          {op.machine
                            ? `${op.machine.name}`
                            : "Unassigned"}
                          {op.machine && (
                            <div className="text-[9px] uppercase tracking-[0.1em] text-neutral-500">
                              {machineKindLabel[op.machine.kind]}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <div className="inline-block w-3.5 h-3.5 border border-neutral-700" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* ── FOOTER: notes / files / QC / sign-off ─────────────────── */}
        <footer className="grid grid-cols-[1fr_220px_220px] divide-x-2 divide-neutral-900 border-t-2 border-neutral-900 text-[10px]">
          <div className="px-3 py-2 flex flex-col gap-1.5 min-h-0 overflow-hidden">
            <div className="uppercase tracking-[0.2em] text-neutral-500">
              Notes
            </div>
            {p.notes ? (
              <div className="text-[11px] leading-snug text-neutral-800 whitespace-pre-wrap line-clamp-4">
                {p.notes}
              </div>
            ) : (
              <div className="text-neutral-400 italic">
                No designer notes.
              </div>
            )}
            {p.attachments.length > 0 && (
              <div className="mt-auto pt-1.5 border-t border-neutral-200">
                <span className="uppercase tracking-[0.2em] text-neutral-500">
                  Files:{" "}
                </span>
                {p.attachments.map((att, i) => (
                  <span key={att.id} className="font-mono">
                    {att.fileName}
                    {i < p.attachments.length - 1 && " · "}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="px-3 py-2 flex flex-col gap-1">
            <div className="uppercase tracking-[0.2em] text-neutral-500 mb-0.5">
              QC quick-check
            </div>
            {QC_QUICK.map((item, i) => (
              <label key={i} className="flex items-start gap-1.5 text-[10px]">
                <span className="inline-block w-3 h-3 border border-neutral-700 shrink-0 mt-px" />
                <span>{item}</span>
              </label>
            ))}
          </div>

          <div className="px-3 py-2 flex flex-col gap-2">
            <div className="uppercase tracking-[0.2em] text-neutral-500 mb-0.5">
              Sign-off
            </div>
            <SignLine label="Operator" />
            <SignLine label="QC" />
            <SignLine label="Actual time" mono />
          </div>
        </footer>
      </article>
    </div>
  );
}

function TitleBlock({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-col justify-center px-4 py-1.5 border-l-2 border-neutral-900 " +
        (last ? "" : "")
      }
    >
      <span className="text-[8px] uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </span>
      <div className="leading-tight">{children}</div>
    </div>
  );
}

function SpecRow({
  label,
  value,
  mono,
  emphasis,
  rightBorder = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  emphasis?: boolean;
  rightBorder?: boolean;
}) {
  return (
    <div
      className={
        "flex items-baseline gap-2 px-3 py-1.5 border-b border-neutral-300 " +
        (rightBorder ? "border-r border-neutral-300" : "")
      }
    >
      <dt className="text-[9px] uppercase tracking-[0.15em] text-neutral-500 w-[70px] shrink-0">
        {label}
      </dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (emphasis ? "font-bold text-red-700 " : "text-neutral-900 ") +
          "text-[12px] leading-tight whitespace-normal break-words"
        }
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "px-2 py-1 text-left text-[9px] uppercase tracking-[0.15em] text-neutral-500 font-medium " +
        className
      }
    >
      {children}
    </th>
  );
}

function SignLine({ label, mono }: { label: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={
          "border-b border-neutral-700 h-4 " + (mono ? "font-mono" : "")
        }
      />
      <span className="text-[9px] uppercase tracking-[0.15em] text-neutral-500">
        {label}
      </span>
    </div>
  );
}
