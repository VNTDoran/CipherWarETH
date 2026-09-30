import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, cookieOptions, createToken, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a username and password" }, { status: 400 });
  }
  const { username, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { OR: [{ username }, { email: username }] },
  });
  // Same message either way, so the form cannot be used to enumerate accounts.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const token = await createToken({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, displayName: user.displayName, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return res;
}
