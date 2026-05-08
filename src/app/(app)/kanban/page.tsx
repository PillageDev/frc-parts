import { KanbanBoard } from "@/components/kanban/kanban-board";

export default function KanbanPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Kanban
        </h1>
        <p className="text-muted-foreground mt-1">
          Drag and drop cards through the lifecycle. Blocking parts ring red.
        </p>
      </div>
      <KanbanBoard />
    </div>
  );
}
