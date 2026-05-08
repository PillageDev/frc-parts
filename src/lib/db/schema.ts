import { sql, relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { createId } from "@/lib/id";

// ─────────────────────────────────────────────────────────────────────────────
// Auth (better-auth managed)
// ─────────────────────────────────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  role: text("role", { enum: ["designer", "lead", "manufacturer", "admin"] })
    .notNull()
    .default("designer"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Manufacturing domain
// ─────────────────────────────────────────────────────────────────────────────

export const MACHINE_KINDS = [
  "cnc_router",
  "cnc_mill",
  "manual_mill",
  "lathe",
  "laser_cutter",
  "3d_printer",
  "bandsaw",
  "chopsaw",
  "bench",
  "waterjet",
  "outsource",
] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

export const PART_STATUSES = [
  "ready_to_make",
  "in_production",
  "qc",
  "done",
  "on_robot",
] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const STEP_STATUSES = [
  "not_started",
  "in_queue",
  "in_progress",
  "qc_check",
  "complete",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const PRIORITIES = ["blocking", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PART_TYPES = ["custom", "cots"] as const;
export type PartType = (typeof PART_TYPES)[number];

/**
 * Built-in stock types. These match the keys of seeded route templates and
 * are the values `detectStockType()` is allowed to return. Users can also
 * create their own templates with arbitrary keys — those are stored in
 * `route_template` and assigned manually (never auto-detected).
 */
export const STOCK_TYPES = [
  "auto",   // detect from material + geometry
  "tubing", // box tube / extrusion — bandsaw cut to length only
  "plate",  // sheet/plate stock — router/laser
  "block",  // billet — mill it
  "round",  // round stock — lathe
  "print",  // 3D-printed plastic
  "manual", // hand fabrication only
] as const;
export type BuiltinStockType = (typeof STOCK_TYPES)[number];
/** A part's saved stock type can be any registered template key. */
export type StockType = string;

export const machine = sqliteTable("machine", {
  id: text("id").primaryKey().$defaultFn(() => createId("mch")),
  name: text("name").notNull(),
  kind: text("kind", { enum: MACHINE_KINDS }).notNull(),
  description: text("description"),
  capacityNote: text("capacity_note"),
  costPerHourCents: integer("cost_per_hour_cents").notNull().default(0),
  isOutsource: integer("is_outsource", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const assembly = sqliteTable(
  "assembly",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("asm")),
    name: text("name").notNull(),
    onshapeDocumentId: text("onshape_document_id"),
    onshapeWorkspaceId: text("onshape_workspace_id"),
    onshapeElementId: text("onshape_element_id"),
    onshapeUrl: text("onshape_url"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("assembly_onshape_idx").on(t.onshapeDocumentId)],
);

export const part = sqliteTable(
  "part",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("prt")),
    name: text("name").notNull(),
    partNumber: text("part_number").notNull().unique(),
    description: text("description"),
    type: text("type", { enum: PART_TYPES }).notNull().default("custom"),
    status: text("status", { enum: PART_STATUSES })
      .notNull()
      .default("ready_to_make"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
    assemblyId: text("assembly_id").references(() => assembly.id, {
      onDelete: "set null",
    }),

    // Onshape metadata
    onshapeDocumentId: text("onshape_document_id"),
    onshapePartId: text("onshape_part_id"),
    onshapeElementId: text("onshape_element_id"),
    onshapeVersionId: text("onshape_version_id"),
    onshapeMicroversionId: text("onshape_microversion_id"),
    onshapeUrl: text("onshape_url"),
    thumbnailUrl: text("thumbnail_url"),
    designChanged: integer("design_changed", { mode: "boolean" })
      .notNull()
      .default(false),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),

    // Geometry / material
    material: text("material"),
    massGrams: real("mass_grams"),
    volumeMm3: real("volume_mm3"),
    bboxXMm: real("bbox_x_mm"),
    bboxYMm: real("bbox_y_mm"),
    bboxZMm: real("bbox_z_mm"),

    // COTS
    vendor: text("vendor"),
    vendorPartNumber: text("vendor_part_number"),
    unitPriceCents: integer("unit_price_cents"),

    // Quantity (for the BOM / build)
    quantity: integer("quantity").notNull().default(1),

    // Stock type — references a route template key. Allowed values are the
    // built-in `STOCK_TYPES` plus any user-defined template key.
    stockType: text("stock_type").notNull().default("block"),

    // Optional grouping into a user-defined folder (subsystem etc.)
    folderId: text("folder_id"),

    // Batch grouping (parts in the same batch run together)
    batchKey: text("batch_key"),

    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("part_status_idx").on(t.status),
    index("part_priority_idx").on(t.priority),
    index("part_assembly_idx").on(t.assemblyId),
    index("part_batch_idx").on(t.batchKey),
    index("part_folder_idx").on(t.folderId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Folders (group parts by subsystem / area)
// ─────────────────────────────────────────────────────────────────────────────

export const folder = sqliteTable("folder", {
  id: text("id").primaryKey().$defaultFn(() => createId("fld")),
  name: text("name").notNull(),
  description: text("description"),
  /** Optional accent color hex (e.g. #f59e0b). */
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ─────────────────────────────────────────────────────────────────────────────
// Route templates (default operations per stock type)
// ─────────────────────────────────────────────────────────────────────────────

export const routeTemplate = sqliteTable(
  "route_template",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("tpl")),
    /** Stable lookup key, e.g. "tubing", "plate", "my-custom-process". */
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    description: text("description"),
    /** Built-in templates can be edited but not deleted. */
    isBuiltin: integer("is_builtin", { mode: "boolean" })
      .notNull()
      .default(false),
    /** When true, `detectStockType()` is allowed to return this key. */
    isAutoDetectable: integer("is_auto_detectable", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("route_template_key_idx").on(t.key)],
);

export const routeTemplateStep = sqliteTable(
  "route_template_step",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("tps")),
    templateId: text("template_id")
      .notNull()
      .references(() => routeTemplate.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    /**
     * Preferred machine. Resilient to that machine being deleted (set null).
     * Routing prefers this over `machineKind`.
     */
    machineId: text("machine_id").references(() => machine.id, {
      onDelete: "set null",
    }),
    /** Fallback used if `machineId` isn't set or the machine was deleted. */
    machineKind: text("machine_kind", { enum: MACHINE_KINDS }).notNull(),
    estMinutes: integer("est_minutes").notNull().default(15),
  },
  (t) => [
    index("template_step_template_idx").on(t.templateId),
    index("template_step_sequence_idx").on(t.sequence),
    index("template_step_machine_idx").on(t.machineId),
  ],
);

export const partRevision = sqliteTable(
  "part_revision",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("rev")),
    partId: text("part_id")
      .notNull()
      .references(() => part.id, { onDelete: "cascade" }),
    onshapeVersionId: text("onshape_version_id"),
    onshapeMicroversionId: text("onshape_microversion_id"),
    versionLabel: text("version_label").notNull(),
    massGrams: real("mass_grams"),
    volumeMm3: real("volume_mm3"),
    changeSummary: text("change_summary"),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("rev_part_idx").on(t.partId)],
);

export const operation = sqliteTable(
  "operation",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("op")),
    partId: text("part_id")
      .notNull()
      .references(() => part.id, { onDelete: "cascade" }),
    machineId: text("machine_id").references(() => machine.id, {
      onDelete: "set null",
    }),
    sequence: integer("sequence").notNull().default(0),
    name: text("name").notNull(),
    status: text("status", { enum: STEP_STATUSES })
      .notNull()
      .default("not_started"),
    estMinutes: integer("est_minutes"),
    actualMinutes: integer("actual_minutes"),
    autoAssigned: integer("auto_assigned", { mode: "boolean" })
      .notNull()
      .default(true),
    notes: text("notes"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    assignedTo: text("assigned_to").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("op_part_idx").on(t.partId),
    index("op_machine_idx").on(t.machineId),
    index("op_status_idx").on(t.status),
  ],
);

export const attachment = sqliteTable(
  "attachment",
  {
    id: text("id").primaryKey().$defaultFn(() => createId("att")),
    partId: text("part_id").references(() => part.id, { onDelete: "cascade" }),
    operationId: text("operation_id").references(() => operation.id, {
      onDelete: "cascade",
    }),
    fileName: text("file_name").notNull(),
    fileKind: text("file_kind", {
      enum: ["gcode", "nc", "dxf", "svg", "stl", "step", "pdf", "other"],
    }).notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    url: text("url").notNull(),
    uploadedBy: text("uploaded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("att_part_idx").on(t.partId), index("att_op_idx").on(t.operationId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────────

export const assemblyRelations = relations(assembly, ({ many }) => ({
  parts: many(part),
}));

export const partRelations = relations(part, ({ many, one }) => ({
  assembly: one(assembly, {
    fields: [part.assemblyId],
    references: [assembly.id],
  }),
  folder: one(folder, {
    fields: [part.folderId],
    references: [folder.id],
  }),
  operations: many(operation),
  revisions: many(partRevision),
  attachments: many(attachment),
}));

export const folderRelations = relations(folder, ({ many }) => ({
  parts: many(part),
}));

export const routeTemplateRelations = relations(routeTemplate, ({ many }) => ({
  steps: many(routeTemplateStep),
}));

export const routeTemplateStepRelations = relations(
  routeTemplateStep,
  ({ one }) => ({
    template: one(routeTemplate, {
      fields: [routeTemplateStep.templateId],
      references: [routeTemplate.id],
    }),
  }),
);

export const operationRelations = relations(operation, ({ one, many }) => ({
  part: one(part, { fields: [operation.partId], references: [part.id] }),
  machine: one(machine, {
    fields: [operation.machineId],
    references: [machine.id],
  }),
  attachments: many(attachment),
  assignee: one(user, {
    fields: [operation.assignedTo],
    references: [user.id],
  }),
}));

export const machineRelations = relations(machine, ({ many }) => ({
  operations: many(operation),
}));

export const partRevisionRelations = relations(partRevision, ({ one }) => ({
  part: one(part, { fields: [partRevision.partId], references: [part.id] }),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  part: one(part, { fields: [attachment.partId], references: [part.id] }),
  operation: one(operation, {
    fields: [attachment.operationId],
    references: [operation.id],
  }),
  uploader: one(user, {
    fields: [attachment.uploadedBy],
    references: [user.id],
  }),
}));

export type Part = typeof part.$inferSelect;
export type NewPart = typeof part.$inferInsert;
export type Operation = typeof operation.$inferSelect;
export type NewOperation = typeof operation.$inferInsert;
export type Machine = typeof machine.$inferSelect;
export type Assembly = typeof assembly.$inferSelect;
export type Attachment = typeof attachment.$inferSelect;
export type PartRevision = typeof partRevision.$inferSelect;
export type Folder = typeof folder.$inferSelect;
export type RouteTemplate = typeof routeTemplate.$inferSelect;
export type RouteTemplateStep = typeof routeTemplateStep.$inferSelect;
