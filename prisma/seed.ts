/**
 * Seeds the reference data the engine reads at match start, plus demo
 * accounts. Safe to re-run — everything is upserted.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AGENCY_META, DIRECTIVES } from "../shared/constants.js";

const prisma = new PrismaClient();

/** Each operation is a 5-step plot; cracking a step leaks that dossier line. */
const OPERATIONS: {
  name: string;
  description: string;
  codenames: string[];
  dossier: string[];
}[] = [
  {
    name: "OPERATION PALIMPSEST",
    description: "Rewrite a rival's archive before anyone notices the original.",
    codenames: ["VELLUM", "INKWELL", "ERASURE", "SCRIBE", "GENUINE"],
    dossier: [
      "A forger has been placed inside the national archive.",
      "The original ledger pages were removed on a Tuesday.",
      "Three signatures were reproduced from a 1974 sample.",
      "The replacement volume is bound and awaiting shelving.",
      "The archive will certify the forgery as the original record.",
    ],
  },
  {
    name: "OPERATION MERIDIAN",
    description: "Move a listening post under a neutral flag.",
    codenames: ["SEXTANT", "DRIFT", "ENSIGN", "ANCHORAGE", "LISTENING"],
    dossier: [
      "A survey vessel was chartered through a shipping shell.",
      "The hull was refitted with a passive array in dry dock.",
      "A neutral registry accepted the falsified tonnage papers.",
      "The vessel anchored eleven kilometres off the cable landing.",
      "The post is live and mirroring the trunk line.",
    ],
  },
  {
    name: "OPERATION LANTERN",
    description: "Turn a rival's own courier network into a broadcast channel.",
    codenames: ["WICK", "GLASS", "OIL", "REFLECTION", "BEACON"],
    dossier: [
      "A junior courier accepted a second salary.",
      "The courier's route was altered by four blocks.",
      "A duplicate satchel was manufactured to match the seal.",
      "Two further couriers were compromised through the first.",
      "Every message on the southern route is now read twice.",
    ],
  },
  {
    name: "OPERATION OBSIDIAN",
    description: "Retire an asset without a body, a file, or a question.",
    codenames: ["SMOKE", "MIRROR", "ASH", "ABSENCE", "OBLIVION"],
    dossier: [
      "The asset was told their extraction had been approved.",
      "A safe house was prepared with no exit on the north side.",
      "Personnel records were reassigned to a dissolved section.",
      "The asset's handler was rotated to another continent.",
      "No department now believes the asset ever existed.",
    ],
  },
  {
    name: "OPERATION DEADBOLT",
    description: "Seize the cipher schedule for the coming quarter.",
    codenames: ["PIN", "BOLT", "STRIKE", "CYLINDER", "KEY"],
    dossier: [
      "The rotation schedule is printed in a single bound copy.",
      "A cleaner was given a camera the size of a button.",
      "Pages 40 through 63 were photographed over nine nights.",
      "The schedule was reconstructed and verified against traffic.",
      "Every cipher for the next quarter is already known.",
    ],
  },
  {
    name: "OPERATION SLATE",
    description: "Erase a debt that three governments insist is real.",
    codenames: ["CHALK", "STROKE", "SPONGE", "SURFACE", "BLANK"],
    dossier: [
      "The debt instrument exists in four physical copies.",
      "Two copies were destroyed in an unremarkable fire.",
      "A clerk in the third capital was persuaded to misfile.",
      "The final copy was replaced with a voided duplicate.",
      "No ledger in Europe now records the obligation.",
    ],
  },
];

async function main() {
  // ── Agencies ──────────────────────────────────────────────────────────
  for (const [code, meta] of Object.entries(AGENCY_META)) {
    await prisma.agencyTemplate.upsert({
      where: { code },
      update: { ...meta, active: true },
      create: { code, ...meta, active: true },
    });
  }

  // ── Operations + their 5 directives ───────────────────────────────────
  for (const op of OPERATIONS) {
    const row = await prisma.operationTemplate.upsert({
      where: { name: op.name },
      update: { description: op.description, active: true },
      create: { name: op.name, description: op.description, active: true },
    });

    for (let i = 0; i < 5; i++) {
      const base = DIRECTIVES[i];
      await prisma.directiveTemplate.upsert({
        where: { operationId_level: { operationId: row.id, level: base.level } },
        update: {
          codename: op.codenames[i],
          dossierLine: op.dossier[i],
          transitMs: base.transitMs,
          dispatchCost: base.dispatchCost,
          crackPayout: base.crackPayout,
        },
        create: {
          operationId: row.id,
          level: base.level,
          codename: op.codenames[i],
          dossierLine: op.dossier[i],
          transitMs: base.transitMs,
          dispatchCost: base.dispatchCost,
          crackPayout: base.crackPayout,
        },
      });
    }
  }

  // Operations are keyed by name, so renaming one leaves the old row behind
  // as an active duplicate — which is exactly what happened when the lore was
  // translated. Retire anything not in the current set rather than letting the
  // engine keep dealing stale plots.
  const current = OPERATIONS.map((o) => o.name);
  const stale = await prisma.operationTemplate.findMany({
    where: { name: { notIn: current } },
    select: { id: true, name: true },
  });
  if (stale.length) {
    await prisma.operationTemplate.deleteMany({ where: { id: { in: stale.map((o) => o.id) } } });
    console.log(`Removed ${stale.length} stale operation(s): ${stale.map((o) => o.name).join(", ")}`);
  }

  // ── Minigame tuning ───────────────────────────────────────────────────
  const games = [
    { key: "cipher_type", label: "Cipher Type", durationMs: 5000, silverAt: 55, goldAt: 80, weight: 1 },
    { key: "frequency_lock", label: "Frequency Lock", durationMs: 4500, silverAt: 50, goldAt: 85, weight: 1 },
    { key: "signal_trace", label: "Signal Trace", durationMs: 4500, silverAt: 60, goldAt: 90, weight: 1 },
  ];
  for (const g of games) {
    await prisma.minigameConfig.upsert({
      where: { key: g.key },
      update: { ...g, enabled: true },
      create: { ...g, enabled: true },
    });
  }

  // ── Demo accounts (password for all: cipher123) ───────────────────────
  const passwordHash = await bcrypt.hash("cipher123", 10);
  const accounts = [
    { username: "admin", email: "admin@cipherwar.dev", displayName: "Directeur", role: "ADMIN" },
    { username: "nord", email: "nord@cipherwar.dev", displayName: "Agent Nord", role: "PLAYER" },
    { username: "est", email: "est@cipherwar.dev", displayName: "Agent Est", role: "PLAYER" },
    { username: "sud", email: "sud@cipherwar.dev", displayName: "Agent Sud", role: "PLAYER" },
    { username: "ouest", email: "ouest@cipherwar.dev", displayName: "Agent Ouest", role: "PLAYER" },
  ];
  for (const a of accounts) {
    await prisma.user.upsert({
      where: { username: a.username },
      update: { displayName: a.displayName, role: a.role },
      create: { ...a, passwordHash, avatarSeed: a.username },
    });
  }

  console.log("Seed complete.");
  console.log("  admin / cipher123   (ADMIN)");
  console.log("  nord, est, sud, ouest / cipher123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
