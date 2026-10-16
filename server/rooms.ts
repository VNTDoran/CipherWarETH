/**
 * Room registry: owns every live Match, loads engine templates out of the
 * database at match start, and writes the result back when it ends.
 *
 * Live state deliberately lives in memory (fast, 10 Hz tick) while the
 * database holds the durable record. The templates are the bridge: they are
 * CRUD-editable rows that the engine reads, so the admin panel genuinely
 * changes how the game plays.
 */

import { prisma } from "../src/lib/db.js";
import { chain } from "./chain/client.js";
import { Match, type OperationSpec } from "./engine/match.js";
import { DEFAULT_TUNING, type MinigameTuning } from "./engine/minigames.js";
import type { MinigameKey } from "../shared/types.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

const matches = new Map<string, Match>();

function makeCode(): string {
  let code = "";
  do {
    code = Array.from(
      { length: 6 },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join("");
  } while (matches.has(code));
  return code;
}

export function getMatch(code: string): Match | undefined {
  return matches.get(code.toUpperCase());
}

export function listMatches(): Match[] {
  return [...matches.values()];
}

export async function createMatch(hostUserId: string): Promise<Match> {
  const code = makeCode();
  const match = new Match(code, hostUserId);
  matches.set(code, match);

  const row = await prisma.match.create({
    data: { code, hostId: hostUserId, status: "LOBBY" },
  });
  match.dbId = row.id;
  return match;
}

export function dropMatch(code: string) {
  matches.delete(code.toUpperCase());
}

export async function loadEngineConfig(): Promise<{
  operations: OperationSpec[];
  tunings: MinigameTuning[];
}> {
  const [ops, games] = await Promise.all([
    prisma.operationTemplate.findMany({
      where: { active: true },
      include: { directives: { orderBy: { level: "asc" } } },
    }),
    prisma.minigameConfig.findMany(),
  ]);

  const operations: OperationSpec[] = ops
    .filter((o) => o.directives.length >= 5)
    .map((o) => ({
      name: o.name,
      description: o.description,
      directives: o.directives.map((d) => ({
        level: d.level,
        codename: d.codename,
        dossierLine: d.dossierLine,
        transitMs: d.transitMs,
        dispatchCost: d.dispatchCost,
        crackPayout: d.crackPayout,
      })),
    }));

  const tunings: MinigameTuning[] = games.length
    ? games.map((g) => ({
        key: g.key as MinigameKey,
        durationMs: g.durationMs,
        silverAt: g.silverAt,
        goldAt: g.goldAt,
        weight: g.weight,
        enabled: g.enabled,
      }))
    : DEFAULT_TUNING;

  return { operations, tunings };
}

/** Called once a match reaches FINISHED. Writes the durable record. */
export async function persistResult(match: Match): Promise<void> {
  if (!match.dbId) return;
  const results = match.results();
  const winner = results.find((r) => r.isWinner);

  // Anchor the outcome and release both pots before the database write: it is
  // the part players can actually verify, so a DB failure must not skip it.
  anchorResult(match, results, winner);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: match.dbId! },
        data: {
          status: "FINISHED",
          endedAt: new Date(),
          winnerId: winner?.userId ?? null,
          winType: match.winner?.winType ?? "TIMEOUT",
          durationMs: match.startedAt ? Date.now() - match.startedAt : null,
        },
      });

      for (const r of results) {
        const player = match.playerList.find((p) => p.slot === r.slot);
        await tx.matchPlayer.upsert({
          where: { matchId_userId: { matchId: match.dbId!, userId: r.userId } },
          create: {
            matchId: match.dbId!,
            userId: r.userId,
            slot: r.slot,
            agencyCode: player?.agency ?? "NORD",
            operationName: player?.operation.name ?? "",
            finalIntel: r.finalIntel,
            directivesConfirmed: r.directivesConfirmed,
            cracksMade: r.cracksMade,
            timesCracked: r.timesCracked,
            spiesRecruited: r.spiesRecruited,
            encryptLevel: r.encryptLevel,
            decoysBaited: r.decoysBaited,
            placement: r.placement,
            isWinner: r.isWinner,
          },
          update: {
            finalIntel: r.finalIntel,
            directivesConfirmed: r.directivesConfirmed,
            cracksMade: r.cracksMade,
            timesCracked: r.timesCracked,
            spiesRecruited: r.spiesRecruited,
            encryptLevel: r.encryptLevel,
            decoysBaited: r.decoysBaited,
            placement: r.placement,
            isWinner: r.isWinner,
          },
        });
      }
    });
  } catch (err) {
    console.error("[persist] failed to write match result", err);
  }
}

export async function markStarted(match: Match): Promise<void> {
  if (!match.dbId) return;
  try {
    await prisma.match.update({
      where: { id: match.dbId },
      data: { status: "ACTIVE", startedAt: new Date() },
    });
  } catch (err) {
    console.error("[persist] failed to mark match started", err);
  }
}

/**
 * Writes the result to the chain and releases both pots.
 *
 * Only players who linked a wallet can appear on-chain or be paid, so a match
 * played without wallets simply records nothing — the game itself is unaffected.
 */
function anchorResult(
  match: Match,
  results: ReturnType<Match["results"]>,
  winner: { slot: number; userId: string } | undefined,
): void {
  if (!chain.enabled || !match.matchIdHex || !winner) return;

  const withWallets = results
    .map((r) => {
      const p = match.playerList.find((x) => x.slot === r.slot);
      return p?.wallet
        ? {
            player: p.wallet,
            slot: r.slot,
            directivesConfirmed: Math.min(255, r.directivesConfirmed),
            cracksMade: Math.min(255, r.cracksMade),
            finalIntel: Math.max(0, r.finalIntel),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!withWallets.some((r) => r.slot === winner.slot)) {
    console.warn("[chain] winner has no linked wallet — skipping anchor");
    return;
  }

  const winTypeCode =
    match.winner?.winType === "OPERATION" ? 0 : match.winner?.winType === "BLACKOUT" ? 1 : 2;
  const durationSeconds = match.startedAt
    ? Math.round((Date.now() - match.startedAt) / 1000)
    : 0;

  chain.finalizeMatch(
    match.matchIdHex,
    winner.slot,
    winTypeCode,
    durationSeconds,
    withWallets,
  );

  const winnerWallet = withWallets.find((r) => r.slot === winner.slot)!.player;
  chain.payBounty(match.matchIdHex, winnerWallet);
}
