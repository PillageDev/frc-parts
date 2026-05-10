"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  ExternalLink,
  FileDown,
  ListChecks,
  PauseCircle,
  PlayCircle,
  StopCircle,
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { PartThumbnail } from "@/components/parts/part-thumbnail";
import { trpc } from "@/lib/trpc/client";
import { machineKindLabel, statusClass, statusLabel } from "@/lib/labels";
import { formatMinutes, timeAgo } from "@/lib/utils";
import { toast } from "sonner";
import type { StepStatus } from "@/lib/db/schema";

const STEP_BADGE: Record<StepStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_queue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  in_progress: "bg-amber-500/20 text-amber-800 dark:text-amber-200",
  qc_check: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  complete: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200",
};

export default function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const part = trpc.parts.byId.useQuery({ id }, { refetchInterval: 5_000 });
  const utils = trpc.useUtils();

  const setStepStatus = trpc.parts.setStepStatus.useMutation({
    onSuccess: () => {
      utils.parts.byId.invalidate();
      utils.parts.list.invalidate();
      utils.machines.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const start = trpc.parts.startManufacturing.useMutation({
    onSuccess: () => {
      utils.parts.byId.invalidate();
      toast.success("Manufacturing started");
    },
  });

  if (part.isLoading || !part.data) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const p = part.data;
  const ops = p.operations;
  const completeCount = ops.filter((o) => o.status === "complete").length;
  const total = ops.length;
  const pct = total === 0 ? 0 : Math.round((completeCount / total) * 100);

  // The "current step" is the first non-complete step. If everything's done,
  // the last step is shown for review.
  const currentIdx = ops.findIndex((o) => o.status !== "complete");
  const current = currentIdx >= 0 ? ops[currentIdx] : ops[ops.length - 1];
  const allDone = currentIdx === -1 && ops.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href={`/parts/${p.id}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to part
        </Link>
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium " +
              statusClass(p.status)
            }
          >
            {statusLabel[p.status]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        <Card className="overflow-hidden">
          <PartThumbnail
            url={p.thumbnailUrl}
            alt={p.name}
            className="aspect-square rounded-none border-0"
          />
          <CardContent className="p-4 flex flex-col gap-1">
            <h2 className="font-serif text-xl tracking-tight leading-tight">
              {p.name}
            </h2>
            <code className="font-mono text-xs text-muted-foreground">
              {p.partNumber}
            </code>
            <div className="text-xs text-muted-foreground mt-1">
              {p.material ?? "—"}
              {" · "} ×{p.quantity}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  Progress · {completeCount} of {total} steps complete
                </CardTitle>
                <span className="text-xs text-muted-foreground font-mono">
                  {pct}%
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <Progress value={pct} />
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {ops.map((op, i) => {
                  const isCurrent = op.id === current?.id && !allDone;
                  return (
                    <div
                      key={op.id}
                      className={
                        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] " +
                        (op.status === "complete"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                          : isCurrent
                            ? "bg-primary/20 border-primary/60 text-foreground font-medium ring-1 ring-primary/50"
                            : "bg-muted border-border text-muted-foreground")
                      }
                    >
                      {op.status === "complete" ? (
                        <Check className="h-3 w-3" />
                      ) : op.status === "in_progress" ? (
                        <PlayCircle className="h-3 w-3" />
                      ) : (
                        <Circle className="h-3 w-3" />
                      )}
                      <span className="font-mono text-[10px] opacity-60">
                        {i + 1}
                      </span>
                      <span className="truncate max-w-[140px]">{op.name}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {allDone ? (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardContent className="flex items-center gap-3 py-6">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <div className="font-serif text-lg">
                    Manufacturing complete
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Mark the part as installed on the robot when it&apos;s
                    fitted up.
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : current ? (
            <CurrentStepCard
              step={current}
              machineName={
                current.machine
                  ? `${current.machine.name} · ${machineKindLabel[current.machine.kind]}`
                  : "No machine assigned"
              }
              partAttachmentKinds={p.attachments.map((a) => a.fileKind)}
              onStart={() => {
                if (current.status === "not_started") {
                  start.mutate({ id: p.id });
                } else {
                  setStepStatus.mutate({
                    stepId: current.id,
                    status: "in_progress",
                  });
                }
              }}
              onPause={() =>
                setStepStatus.mutate({
                  stepId: current.id,
                  status: "in_queue",
                })
              }
              onComplete={() =>
                setStepStatus.mutate({
                  stepId: current.id,
                  status: "complete",
                })
              }
              onSendToQc={() =>
                setStepStatus.mutate({
                  stepId: current.id,
                  status: "qc_check",
                })
              }
              isPending={setStepStatus.isPending || start.isPending}
            />
          ) : (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground text-center">
                No operations defined for this part.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All steps</CardTitle>
              <CardDescription>
                Click any step to mark its status directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {ops.map((op, i) => (
                <div
                  key={op.id}
                  className={
                    "flex items-center gap-3 rounded-md border bg-card p-2.5 " +
                    (op.id === current?.id && !allDone
                      ? "border-primary/40"
                      : "border-border")
                  }
                >
                  <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {op.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {op.machine
                        ? `${op.machine.name} · ${machineKindLabel[op.machine.kind]}`
                        : "Unassigned"}
                      {op.actualMinutes != null && (
                        <span> · {formatMinutes(op.actualMinutes)}</span>
                      )}
                    </div>
                  </div>
                  <span
                    className={
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium " +
                      STEP_BADGE[op.status]
                    }
                  >
                    {op.status.replace("_", " ")}
                  </span>
                  {op.status !== "complete" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setStepStatus.mutate({
                          stepId: op.id,
                          status: "complete",
                        })
                      }
                      disabled={setStepStatus.isPending}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {p.attachments.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border flex flex-col gap-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Job files
                  </div>
                  {p.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.url}
                      download={att.fileName}
                      className="flex items-center gap-2 text-xs hover:bg-muted rounded px-2 py-1"
                    >
                      <FileDown className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate">{att.fileName}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {att.fileKind}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CurrentStepCard({
  step,
  machineName,
  partAttachmentKinds,
  onStart,
  onPause,
  onComplete,
  onSendToQc,
  isPending,
}: {
  step: {
    id: string;
    name: string;
    status: StepStatus;
    actualMinutes: number | null;
    startedAt: Date | null;
    notes: string | null;
    requireFile: boolean;
    requireFileKind: string | null;
    requireNote: boolean;
  };
  machineName: string;
  partAttachmentKinds: string[];
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  onSendToQc: () => void;
  isPending: boolean;
}) {
  const isRunning = step.status === "in_progress";

  // Live elapsed timer when running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);
  const elapsedMinutes =
    isRunning && step.startedAt
      ? Math.max(
          0,
          Math.floor((now - new Date(step.startedAt).getTime()) / 60_000),
        )
      : null;

  const fileSatisfied =
    !step.requireFile ||
    (step.requireFileKind
      ? partAttachmentKinds.includes(step.requireFileKind)
      : partAttachmentKinds.length > 0);
  const noteSatisfied = !step.requireNote || (step.notes ?? "").trim().length > 0;
  const reqsMet = fileSatisfied && noteSatisfied;

  return (
    <Card className="border-primary/40 ring-1 ring-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 text-foreground">
              {isRunning ? (
                <PlayCircle className="h-5 w-5" />
              ) : (
                <CircleDashed className="h-5 w-5" />
              )}
            </div>
            <div>
              <CardTitle className="text-lg">{step.name}</CardTitle>
              <CardDescription>{machineName}</CardDescription>
            </div>
          </div>
          <Badge variant="secondary">{step.status.replace("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4 text-sm flex-wrap">
          {elapsedMinutes != null && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Elapsed:</span>
              <span className="font-medium font-mono">
                {formatMinutes(elapsedMinutes)}
              </span>
            </div>
          )}
          {step.actualMinutes != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              Last run: {formatMinutes(step.actualMinutes)}
            </div>
          )}
          {step.startedAt && !isRunning && (
            <div className="text-xs text-muted-foreground">
              Last started {timeAgo(step.startedAt)}
            </div>
          )}
        </div>

        {(step.requireFile || step.requireNote) && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Required to mark complete
            </div>
            {step.requireFile && (
              <ReqLine ok={fileSatisfied}>
                {step.requireFileKind
                  ? `Attach a .${step.requireFileKind} file to the part`
                  : "Attach at least one file to the part"}
              </ReqLine>
            )}
            {step.requireNote && (
              <ReqLine ok={noteSatisfied}>
                Add an operator note to this step
              </ReqLine>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {!isRunning ? (
            <Button onClick={onStart} disabled={isPending} size="lg">
              <PlayCircle className="h-4 w-4" />
              {step.status === "in_queue" || step.status === "not_started"
                ? "Start step"
                : "Resume"}
            </Button>
          ) : (
            <>
              <Button
                onClick={onComplete}
                disabled={isPending || !reqsMet}
                size="lg"
                title={
                  reqsMet
                    ? "Mark this step complete"
                    : "Complete the requirements above first"
                }
              >
                <Check className="h-4 w-4" />
                Mark complete
              </Button>
              <Button
                variant="outline"
                onClick={onPause}
                disabled={isPending}
                size="lg"
              >
                <PauseCircle className="h-4 w-4" />
                Pause
              </Button>
              <Button
                variant="outline"
                onClick={onSendToQc}
                disabled={isPending}
                size="lg"
              >
                <ListChecks className="h-4 w-4" />
                Send to QC
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReqLine({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "flex items-center gap-2 text-xs " +
        (ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")
      }
    >
      <span
        className={
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm " +
          (ok
            ? "bg-emerald-500/15 border border-emerald-500/40"
            : "border border-amber-500/60")
        }
      >
        {ok && <Check className="h-2.5 w-2.5" />}
      </span>
      <span>{children}</span>
    </div>
  );
}
