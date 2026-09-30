/**
 * Registry backing the generic admin CRUD routes and UI.
 *
 * One entry per manageable table. Adding a table here gives it a full
 * list/create/update/delete API *and* an admin screen — the routes and the
 * form are both generated from `fields`, so there is exactly one place to
 * change when the schema moves.
 */

import { z } from "zod";
import { prisma } from "./db";

export type FieldType = "text" | "textarea" | "number" | "boolean" | "select" | "password";

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  /** Hidden in the table but still editable (e.g. long prose). */
  hideInTable?: boolean;
  /** Not editable after creation. */
  createOnly?: boolean;
  options?: string[];
  help?: string;
}

export interface ModelSpec {
  key: string;
  label: string;
  description: string;
  /** Rows the engine reads at match start. Surfaced in the UI as a warning. */
  affectsGameplay?: boolean;
  readOnly?: boolean;
  fields: FieldSpec[];
  orderBy: Record<string, "asc" | "desc">;
  include?: Record<string, unknown>;
  search?: string[];
  delegate: () => any;
  createSchema?: z.ZodTypeAny;
  updateSchema?: z.ZodTypeAny;
  /** Transform validated input before it reaches Prisma. */
  transform?: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const bool = z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform((v) => v === true || v === "true");
const int = z.union([z.number(), z.string()]).transform((v) => Math.trunc(Number(v))).pipe(z.number().int());

export const MODELS: Record<string, ModelSpec> = {
  users: {
    key: "users",
    label: "Users",
    description: "Player accounts. Passwords are stored as bcrypt hashes and never returned.",
    delegate: () => prisma.user,
    orderBy: { createdAt: "desc" },
    search: ["username", "email", "displayName"],
    fields: [
      { name: "username", label: "Username", type: "text", createOnly: true },
      { name: "email", label: "Email", type: "text" },
      { name: "displayName", label: "Display name", type: "text" },
      { name: "role", label: "Role", type: "select", options: ["PLAYER", "ADMIN"] },
      {
        name: "password",
        label: "Password",
        type: "password",
        hideInTable: true,
        help: "Leave blank to keep the current password.",
      },
    ],
    createSchema: z.object({
      username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
      email: z.string().email(),
      displayName: z.string().min(2).max(28),
      role: z.enum(["PLAYER", "ADMIN"]).default("PLAYER"),
      password: z.string().min(6).max(72),
    }),
    updateSchema: z.object({
      email: z.string().email().optional(),
      displayName: z.string().min(2).max(28).optional(),
      role: z.enum(["PLAYER", "ADMIN"]).optional(),
      password: z.string().min(6).max(72).optional().or(z.literal("")),
    }),
    transform: async (data) => {
      const out = { ...data };
      const pw = out.password;
      delete out.password;
      if (typeof pw === "string" && pw.length > 0) {
        const bcrypt = (await import("bcryptjs")).default;
        out.passwordHash = await bcrypt.hash(pw, 10);
      }
      return out;
    },
  },

  agencies: {
    key: "agencies",
    label: "Agencies",
    description: "The four playable agencies: identity, colour and flavour.",
    affectsGameplay: true,
    delegate: () => prisma.agencyTemplate,
    orderBy: { code: "asc" },
    search: ["code", "name", "country"],
    fields: [
      { name: "code", label: "Code", type: "text", createOnly: true },
      { name: "name", label: "Name", type: "text" },
      { name: "country", label: "Country", type: "text" },
      { name: "color", label: "Colour", type: "text", help: "Any CSS colour, e.g. #38bdf8" },
      { name: "sigil", label: "Sigil", type: "text" },
      { name: "motto", label: "Motto", type: "text", hideInTable: true },
      { name: "active", label: "Active", type: "boolean" },
    ],
    createSchema: z.object({
      code: z.string().min(2).max(10),
      name: z.string().min(2),
      country: z.string().min(2),
      color: z.string().min(3),
      sigil: z.string().min(1).max(3),
      motto: z.string().default(""),
      active: bool.default(true),
    }),
    updateSchema: z.object({
      name: z.string().min(2).optional(),
      country: z.string().min(2).optional(),
      color: z.string().min(3).optional(),
      sigil: z.string().min(1).max(3).optional(),
      motto: z.string().optional(),
      active: bool.optional(),
    }),
  },

  operations: {
    key: "operations",
    label: "Operations",
    description:
      "The 5-step plots dealt to agencies at match start. An operation needs all 5 directives to be dealt.",
    affectsGameplay: true,
    delegate: () => prisma.operationTemplate,
    orderBy: { name: "asc" },
    search: ["name", "description"],
    include: { _count: { select: { directives: true } } },
    fields: [
      { name: "name", label: "Name", type: "text" },
      { name: "description", label: "Description", type: "textarea", hideInTable: true },
      { name: "active", label: "In rotation", type: "boolean" },
    ],
    createSchema: z.object({
      name: z.string().min(3),
      description: z.string().default(""),
      active: bool.default(true),
    }),
    updateSchema: z.object({
      name: z.string().min(3).optional(),
      description: z.string().optional(),
      active: bool.optional(),
    }),
  },

  directives: {
    key: "directives",
    label: "Directives",
    description:
      "The individual steps. transitMs, dispatchCost and crackPayout are read live by the engine — editing them retunes the game.",
    affectsGameplay: true,
    delegate: () => prisma.directiveTemplate,
    orderBy: { codename: "asc" },
    search: ["codename", "dossierLine"],
    include: { operation: { select: { name: true } } },
    fields: [
      { name: "operationId", label: "Operation ID", type: "text", createOnly: true },
      { name: "level", label: "Level", type: "number", createOnly: true },
      { name: "codename", label: "Codename", type: "text" },
      { name: "dossierLine", label: "Dossier line", type: "textarea", hideInTable: true },
      { name: "transitMs", label: "Transit (ms)", type: "number" },
      { name: "dispatchCost", label: "Dispatch cost", type: "number" },
      { name: "crackPayout", label: "Crack payout", type: "number" },
    ],
    createSchema: z.object({
      operationId: z.string().min(1),
      level: int.pipe(z.number().min(1).max(5)),
      codename: z.string().min(1),
      dossierLine: z.string().default(""),
      transitMs: int.pipe(z.number().min(5000).max(300000)),
      dispatchCost: int.pipe(z.number().min(0).max(1000)),
      crackPayout: int.pipe(z.number().min(0).max(1000)),
    }),
    updateSchema: z.object({
      codename: z.string().min(1).optional(),
      dossierLine: z.string().optional(),
      transitMs: int.pipe(z.number().min(5000).max(300000)).optional(),
      dispatchCost: int.pipe(z.number().min(0).max(1000)).optional(),
      crackPayout: int.pipe(z.number().min(0).max(1000)).optional(),
    }),
  },

  minigames: {
    key: "minigames",
    label: "Minigames",
    description:
      "Attack-resolution tuning. silverAt / goldAt are the raw-score thresholds for 2 and 3 key eliminations.",
    affectsGameplay: true,
    delegate: () => prisma.minigameConfig,
    orderBy: { key: "asc" },
    search: ["key", "label"],
    fields: [
      { name: "key", label: "Key", type: "text", createOnly: true },
      { name: "label", label: "Label", type: "text" },
      { name: "enabled", label: "Enabled", type: "boolean" },
      { name: "durationMs", label: "Duration (ms)", type: "number" },
      { name: "silverAt", label: "Silver at", type: "number" },
      { name: "goldAt", label: "Gold at", type: "number" },
      { name: "weight", label: "Pick weight", type: "number" },
    ],
    createSchema: z.object({
      key: z.enum(["cipher_type", "frequency_lock", "signal_trace"]),
      label: z.string().min(1),
      enabled: bool.default(true),
      durationMs: int.pipe(z.number().min(2000).max(30000)),
      silverAt: int.pipe(z.number().min(0).max(100)),
      goldAt: int.pipe(z.number().min(0).max(100)),
      weight: int.pipe(z.number().min(0).max(10)),
    }),
    updateSchema: z.object({
      label: z.string().min(1).optional(),
      enabled: bool.optional(),
      durationMs: int.pipe(z.number().min(2000).max(30000)).optional(),
      silverAt: int.pipe(z.number().min(0).max(100)).optional(),
      goldAt: int.pipe(z.number().min(0).max(100)).optional(),
      weight: int.pipe(z.number().min(0).max(10)).optional(),
    }),
  },

  matches: {
    key: "matches",
    label: "Matches",
    description: "Recorded matches. Read-only apart from deletion.",
    readOnly: true,
    delegate: () => prisma.match,
    orderBy: { createdAt: "desc" },
    search: ["code", "status"],
    include: { players: { select: { id: true } }, winner: { select: { displayName: true } } },
    fields: [
      { name: "code", label: "Code", type: "text" },
      { name: "status", label: "Status", type: "text" },
      { name: "winType", label: "Win type", type: "text" },
      { name: "durationMs", label: "Duration (ms)", type: "number" },
    ],
  },
};

export function getModel(key: string): ModelSpec | null {
  return MODELS[key] ?? null;
}
