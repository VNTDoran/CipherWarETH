import type { Match } from "./server/engine/match";

declare global {
  /**
   * The custom server publishes its in-memory room registry here so Next.js
   * route handlers — which run in the same process — can create and look up
   * matches without an internal HTTP round trip.
   */
  // eslint-disable-next-line no-var
  var __cipherWarCreateMatch: ((hostUserId: string) => Promise<Match>) | undefined;
  // eslint-disable-next-line no-var
  var __cipherWarGetMatch: ((code: string) => Match | undefined) | undefined;
}

export {};
