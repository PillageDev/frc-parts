"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";
import type { Machine } from "@/lib/db/schema";
import { toast } from "sonner";

export function AddStepForm({
  partId,
  machines,
}: {
  partId: string;
  machines: Machine[];
}) {
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState<string>("none");
  const [estMinutes, setEstMinutes] = useState("");
  const utils = trpc.useUtils();
  const addStep = trpc.parts.addStep.useMutation({
    onSuccess: () => {
      utils.parts.byId.invalidate();
      setName("");
      setEstMinutes("");
      toast.success("Step added");
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        addStep.mutate({
          partId,
          name: name.trim(),
          machineId: machineId === "none" ? null : machineId,
          estMinutes: estMinutes ? Number(estMinutes) : undefined,
        });
      }}
    >
      <Input
        placeholder='e.g. "Tap holes after CNC", "Sand after laser cut"'
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 min-w-[260px]"
      />
      <Select value={machineId} onValueChange={setMachineId}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Pick machine" />
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
      <Input
        placeholder="Est min"
        type="number"
        min={0}
        value={estMinutes}
        onChange={(e) => setEstMinutes(e.target.value)}
        className="w-[110px]"
      />
      <Button type="submit">
        <Plus className="h-4 w-4" />
        Add step
      </Button>
    </form>
  );
}
