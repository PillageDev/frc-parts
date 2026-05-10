"use client";

import { useState } from "react";
import {
  Check,
  CircleDashed,
  ListChecks,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc/client";
import {
  STEP_STATUSES,
  type Machine,
  type Operation,
  type StepStatus,
} from "@/lib/db/schema";
import {
  machineKindLabel,
  stepStatusClass,
  stepStatusLabel,
} from "@/lib/labels";
import { formatMinutes } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_ICONS: Record<StepStatus, React.ReactNode> = {
  not_started: <CircleDashed className="h-3.5 w-3.5" />,
  in_queue: <ListChecks className="h-3.5 w-3.5" />,
  in_progress: <PlayCircle className="h-3.5 w-3.5" />,
  qc_check: <ListChecks className="h-3.5 w-3.5" />,
  complete: <Check className="h-3.5 w-3.5" />,
};

export function OperationRow({
  op,
  machine,
  machines,
  index,
}: {
  op: Operation;
  machine: Machine | null;
  machines: Machine[];
  index: number;
}) {
  const utils = trpc.useUtils();
  const setStatus = trpc.parts.setStepStatus.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reassign = trpc.parts.reassignStep.useMutation({
    onSuccess: () => {
      utils.parts.byId.invalidate();
      toast.success("Step reassigned");
    },
  });
  const removeStep = trpc.parts.removeStep.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });
  const setActuals = trpc.parts.setStepActuals.useMutation({
    onSuccess: () => utils.parts.byId.invalidate(),
  });

  const [actualDraft, setActualDraft] = useState<string>(
    op.actualMinutes != null ? String(op.actualMinutes) : "",
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="font-serif text-2xl text-muted-foreground/80 leading-none w-6 shrink-0">
            {index + 1}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate flex items-center gap-2">
              {op.name}
              {op.autoAssigned && (
                <Badge variant="muted" className="text-[10px]">
                  auto
                </Badge>
              )}
              {op.requireFile && (
                <Badge variant="warning" className="text-[10px]">
                  needs {op.requireFileKind ?? "file"}
                </Badge>
              )}
              {op.requireNote && (
                <Badge variant="warning" className="text-[10px]">
                  needs note
                </Badge>
              )}
            </div>
            {machine && (
              <div className="text-xs text-muted-foreground">
                {machine.name} · {machineKindLabel[machine.kind]}
              </div>
            )}
            {!machine && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                No machine assigned
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={op.status}
            onValueChange={(v) =>
              setStatus.mutate({ stepId: op.id, status: v as StepStatus })
            }
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue>
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium " +
                    stepStatusClass(op.status)
                  }
                >
                  {STATUS_ICONS[op.status]}
                  {stepStatusLabel[op.status]}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STEP_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {stepStatusLabel[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeStep.mutate({ stepId: op.id })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
            Machine override
          </span>
          <Select
            value={op.machineId ?? "none"}
            onValueChange={(v) =>
              reassign.mutate({
                stepId: op.id,
                machineId: v === "none" ? null : v,
              })
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {machines.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
            Actual minutes
          </span>
          <Input
            type="number"
            min={0}
            value={actualDraft}
            onChange={(e) => setActualDraft(e.target.value)}
            onBlur={() => {
              const n = Number(actualDraft);
              if (!Number.isNaN(n) && n !== op.actualMinutes) {
                setActuals.mutate({ stepId: op.id, actualMinutes: n });
              }
            }}
            className="h-8"
          />
        </label>
      </div>

      {op.actualMinutes != null && (
        <div className="text-[11px] text-muted-foreground">
          Logged {formatMinutes(op.actualMinutes)}
        </div>
      )}
    </div>
  );
}
