import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Match creation lives on the HTTP side because that is where the session
 * cookie is. The custom server exposes the in-memory room registry on
 * globalThis; both run in the same process, so this is a direct call rather
 * than a network hop.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const create = globalThis.__cipherWarCreateMatch;
  if (!create) {
    return NextResponse.json(
      { error: "Game server is not running. Start the app with `npm run dev`." },
      { status: 503 },
    );
  }

  const match = await create(session.sub);
  return NextResponse.json({ code: match.code });
}
