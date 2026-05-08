"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Clock,
  Cpu,
  Pencil,
  Plus,
  Trash2,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { machineKindLabel } from "@/lib/labels";
import { formatMinutes } from "@/lib/utils";
import {
  MACHINE_KINDS,
  type Machine,
  type MachineKind,
} from "@/lib/db/schema";
import { toast } from "sonner";

type EditingDraft = {
  id?: string;
  name: string;
  kind: MachineKind;
  description: string;
  capacityNote: string;
  costPerHourCents: number;
};

const EMPTY_DRAFT: EditingDraft = {
  name: "",
  kind: "bench",
  description: "",
  capacityNote: "",
  costPerHourCents: 0,
};

export default function MachinesPage() {
  const list = trpc.machines.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = useState<EditingDraft | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Machines
          </h1>
          <p className="text-muted-foreground mt-1">
            Add or remove machines as your shop changes. Each machine gets its
            own queue / operator dashboard.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...EMPTY_DRAFT })}>
          <Plus className="h-4 w-4" />
          Add machine
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.data?.map(
          ({ machine: m, queued, active, done, estPendingMinutes }) => (
            <MachineCard
              key={m.id}
              machine={m}
              queued={Number(queued)}
              active={Number(active)}
              done={Number(done)}
              estPendingMinutes={Number(estPendingMinutes)}
              onEdit={() =>
                setEditing({
                  id: m.id,
                  name: m.name,
                  kind: m.kind,
                  description: m.description ?? "",
                  capacityNote: m.capacityNote ?? "",
                  costPerHourCents: m.costPerHourCents,
                })
              }
            />
          ),
        )}
      </div>

      <MachineDialog
        draft={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function MachineCard({
  machine: m,
  queued,
  active,
  done,
  estPendingMinutes,
  onEdit,
}: {
  machine: Machine;
  queued: number;
  active: number;
  done: number;
  estPendingMinutes: number;
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState(false);
  const remove = trpc.machines.delete.useMutation({
    onSuccess: () => {
      utils.machines.list.invalidate();
      utils.parts.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success(`Removed "${m.name}"`);
      setConfirm(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Card className="h-full group transition-colors hover:border-primary/50 relative">
        <Link
          href={`/machines/${m.id}`}
          className="absolute inset-0 z-0 rounded-lg"
          aria-label={`Open ${m.name}`}
        />
        <CardHeader className="relative z-10 pointer-events-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">{m.name}</CardTitle>
                <CardDescription className="text-[11px] uppercase tracking-widest">
                  {machineKindLabel[m.kind]}
                </CardDescription>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 relative z-10 pointer-events-none">
          {m.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {m.description}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Queued" value={queued} />
            <Stat label="Active" value={active} accent={active > 0} />
            <Stat label="Done" value={done} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {estPendingMinutes > 0
              ? `${formatMinutes(estPendingMinutes)} of work pending`
              : "Idle"}
          </div>
        </CardContent>

        <div className="absolute top-2 right-2 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-card/80 backdrop-blur"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit();
            }}
            title="Edit machine"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-card/80 backdrop-blur text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirm(true);
            }}
            title="Remove machine"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </Card>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this machine?</DialogTitle>
            <DialogDescription>
              <strong>{m.name}</strong> will be removed. Operations and
              template steps that referenced it become unassigned — operators
              can re-route or pick a new machine. The machine&apos;s history
              isn&apos;t recoverable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirm(false)}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate({ id: m.id })}
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MachineDialog({
  draft,
  onClose,
}: {
  draft: EditingDraft | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [local, setLocal] = useState<EditingDraft>(draft ?? EMPTY_DRAFT);

  // Sync local state whenever a new draft comes in (open / change row).
  if (draft && local !== draft && local.id !== draft.id) {
    setLocal(draft);
  }

  const create = trpc.machines.create.useMutation({
    onSuccess: () => {
      utils.machines.list.invalidate();
      toast.success("Machine added");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.machines.update.useMutation({
    onSuccess: () => {
      utils.machines.list.invalidate();
      utils.templates.list.invalidate();
      toast.success("Machine updated");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const isCreate = !draft?.id;
  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreate ? "Add machine" : "Edit machine"}</DialogTitle>
          <DialogDescription>
            Anything you set up here shows up in the templates dropdown and
            in part-detail machine overrides.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-name">Name</Label>
            <Input
              id="m-name"
              placeholder='e.g. "Tormach 1100 P CNC"'
              value={local.name}
              onChange={(e) => setLocal({ ...local, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-kind">Kind</Label>
            <Select
              value={local.kind}
              onValueChange={(v) =>
                setLocal({ ...local, kind: v as MachineKind })
              }
            >
              <SelectTrigger id="m-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MACHINE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {machineKindLabel[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              The kind drives auto-routing fallback when a template step has
              no specific machine pinned.
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-desc">Description</Label>
            <Textarea
              id="m-desc"
              placeholder="What you'd run on it…"
              value={local.description}
              onChange={(e) =>
                setLocal({ ...local, description: e.target.value })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-cap">Capacity / notes</Label>
            <Input
              id="m-cap"
              placeholder='e.g. "256×256×256 mm build volume"'
              value={local.capacityNote}
              onChange={(e) =>
                setLocal({ ...local, capacityNote: e.target.value })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-cost">Cost per hour ($)</Label>
            <Input
              id="m-cost"
              type="number"
              min={0}
              value={(local.costPerHourCents / 100).toString()}
              onChange={(e) =>
                setLocal({
                  ...local,
                  costPerHourCents: Math.round(
                    Number(e.target.value || 0) * 100,
                  ),
                })
              }
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!local.name.trim()) return;
              if (isCreate) {
                create.mutate({
                  name: local.name,
                  kind: local.kind,
                  description: local.description || null,
                  capacityNote: local.capacityNote || null,
                  costPerHourCents: local.costPerHourCents,
                });
              } else if (draft?.id) {
                update.mutate({
                  id: draft.id,
                  name: local.name,
                  kind: local.kind,
                  description: local.description || null,
                  capacityNote: local.capacityNote || null,
                  costPerHourCents: local.costPerHourCents,
                });
              }
            }}
            disabled={!local.name.trim() || pending}
          >
            {isCreate ? "Add" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2 text-center">
      <div
        className={
          "font-serif text-xl " +
          (accent ? "text-primary" : "text-foreground")
        }
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
