"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Cpu,
  GripVertical,
  Lock,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { machineKindLabel } from "@/lib/labels";
import type { Machine } from "@/lib/db/schema";
import { toast } from "sonner";

type StepDraft = {
  name: string;
  machineId: string | null;
  estMinutes: number;
};

export default function TemplatesPage() {
  const list = trpc.templates.list.useQuery();
  const machinesQuery = trpc.machines.list.useQuery();
  const machines = (machinesQuery.data ?? []).map((row) => row.machine);
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);

  const remove = trpc.templates.delete.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Route templates
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Each stock type is a route template — an ordered list of default
            operations applied when a part is imported or its stock type
            changes. Built-in templates can be auto-detected; custom templates
            are only used when picked manually.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New template
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.data?.map((tmpl) => (
          <TemplateCard
            key={tmpl.id}
            template={tmpl}
            machines={machines}
            onDelete={() => {
              if (
                confirm(
                  `Delete the "${tmpl.label}" template? Parts that use it will keep their current operations but won't get re-routed when changed back.`,
                )
              ) {
                remove.mutate({ id: tmpl.id });
              }
            }}
          />
        ))}
        {list.isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
      </div>

      <CreateTemplateDialog
        open={creating}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function TemplateCard({
  template,
  machines,
  onDelete,
}: {
  template: {
    id: string;
    key: string;
    label: string;
    description: string | null;
    isBuiltin: boolean;
    isAutoDetectable: boolean;
    steps: Array<{
      id: string;
      sequence: number;
      name: string;
      machineId: string | null;
      estMinutes: number;
    }>;
  };
  machines: Machine[];
  onDelete: () => void;
}) {
  const utils = trpc.useUtils();
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    template.steps.map((s) => ({
      name: s.name,
      machineId: s.machineId,
      estMinutes: s.estMinutes,
    })),
  );
  const [label, setLabel] = useState(template.label);
  const [description, setDescription] = useState(template.description ?? "");
  const [dirty, setDirty] = useState(false);

  // Keep local state in sync if the server data changes (e.g. another tab).
  useEffect(() => {
    setSteps(
      template.steps.map((s) => ({
        name: s.name,
        machineId: s.machineId,
        estMinutes: s.estMinutes,
      })),
    );
    setLabel(template.label);
    setDescription(template.description ?? "");
    setDirty(false);
  }, [template]);

  const update = trpc.templates.update.useMutation();
  const setStepsMut = trpc.templates.setSteps.useMutation();

  async function save() {
    await Promise.all([
      update.mutateAsync({
        id: template.id,
        label,
        description: description || null,
      }),
      setStepsMut.mutateAsync({ id: template.id, steps }),
    ]);
    utils.templates.list.invalidate();
    toast.success(`Saved "${label}"`);
    setDirty(false);
  }

  function patchStep(i: number, patch: Partial<StepDraft>) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
    setDirty(true);
  }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return next;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }
  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function addStep() {
    setSteps((s) => [
      ...s,
      { name: "", machineId: null, estMinutes: 10 },
    ]);
    setDirty(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setDirty(true);
              }}
              className="font-serif text-lg font-semibold border-transparent bg-transparent px-0 h-auto py-0 shadow-none focus-visible:ring-0 focus-visible:bg-card focus-visible:px-2 focus-visible:py-1"
            />
            <CardDescription className="font-mono text-[11px]">
              key:{" "}
              <span className="text-foreground/80">{template.key}</span>
              {template.isBuiltin && (
                <Badge variant="muted" className="ml-2">
                  <Lock className="h-3 w-3" />
                  Built-in
                </Badge>
              )}
              {template.isAutoDetectable ? (
                <Badge variant="success" className="ml-2">
                  <Sparkles className="h-3 w-3" />
                  Auto-detected
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-2">
                  Manual only
                </Badge>
              )}
            </CardDescription>
          </div>
          {!template.isBuiltin && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          placeholder="What kind of part this template handles…"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setDirty(true);
          }}
          className="text-xs min-h-[44px]"
        />

        <div className="flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-border bg-card p-2"
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="font-mono text-[10px] text-muted-foreground w-4 text-center">
                {i + 1}
              </span>
              <Input
                value={s.name}
                onChange={(e) => patchStep(i, { name: e.target.value })}
                placeholder="Step name (e.g. CNC Mill)"
                className="flex-1 h-8"
              />
              <Select
                value={s.machineId ?? "__none__"}
                onValueChange={(v) =>
                  patchStep(i, { machineId: v === "__none__" ? null : v })
                }
              >
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="Pick a machine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    Unassigned (operator picks)
                  </SelectItem>
                  {machines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {machineKindLabel[m.kind]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                value={s.estMinutes}
                onChange={(e) =>
                  patchStep(i, {
                    estMinutes: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="h-8 w-[80px] text-center"
              />
              <span className="text-[10px] text-muted-foreground">min</span>
              <div className="flex flex-col">
                <button
                  className="text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-30"
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-30"
                  onClick={() => moveStep(i, 1)}
                  disabled={i === steps.length - 1}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
              <button
                onClick={() => removeStep(i)}
                className="text-muted-foreground hover:text-destructive p-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {steps.length === 0 && (
            <div className="text-xs text-muted-foreground py-2 text-center">
              No steps. Add one below.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={addStep}>
            <Plus className="h-3.5 w-3.5" />
            Add step
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={
              !dirty ||
              !label.trim() ||
              steps.some((s) => !s.name.trim()) ||
              update.isPending ||
              setStepsMut.isPending
            }
          >
            <Save className="h-3.5 w-3.5" />
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateTemplateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const create = trpc.templates.create.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      toast.success(`Created "${label}"`);
      setKey("");
      setLabel("");
      setDescription("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-generate key from label if user hasn't typed one
  useEffect(() => {
    if (!key && label) {
      const k = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (k) setKey(k);
    }
  }, [label, key]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom template</DialogTitle>
          <DialogDescription>
            Custom templates aren&apos;t auto-detected — you pick them
            manually when importing or via right-click → Stock type. After
            creating, edit the steps inline on the template card.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-label">Display name</Label>
            <Input
              id="tpl-label"
              placeholder="Punched 1×1 box"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-key">Key</Label>
            <Input
              id="tpl-key"
              placeholder="punched-box-1x1"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="font-mono text-xs"
            />
            <span className="text-[11px] text-muted-foreground">
              Stable lookup id. Letters, numbers, dashes, underscores.
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-desc">Description (optional)</Label>
            <Textarea
              id="tpl-desc"
              placeholder="When to pick this template…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                key,
                label,
                description: description || undefined,
                steps: [],
              })
            }
            disabled={!key.trim() || !label.trim() || create.isPending}
          >
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
