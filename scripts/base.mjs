/**
 * Where the game server is listening.
 *
 * Plain `node` does not read .env (only the server does, via @next/env), so
 * these helper scripts would otherwise default to the wrong port whenever PORT
 * is set — which is exactly what happened. Resolution order:
 *   BASE env var  ->  PORT env var  ->  PORT in .env  ->  3000
 */
import { readFileSync } from "node:fs";

function portFromEnvFile() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("PORT="));
    const value = line?.split("=")[1]?.trim().replace(/^"|"$/g, "");
    return value && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export const BASE =
  process.env.BASE ?? `http://localhost:${process.env.PORT ?? portFromEnvFile() ?? 3000}`;
