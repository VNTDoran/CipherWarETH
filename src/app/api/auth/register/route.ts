import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, cookieOptions, createToken, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscore only"),
  email: z.string().email("Enter a valid email"),
  displayName: z.string().min(2, "Display name is too short").max(28),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { username, email, displayName, password } = parsed.data;

  const clash = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { username: true },
  });
  if (clash) {
    return NextResponse.json(
      { error: clash.username === username ? "Username is taken" : "Email already registered" },
      { status: 409 },
    );
  }

  const user = await prisma.user.create({
    data: {
      username,
      email,
      displayName,
      passwordHash: await hashPassword(password),
      avatarSeed: username,
    },
  });

  const token = await createToken({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });

  const res = NextResponse.json({ ok: true, user: { id: user.id, displayName: user.displayName } });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return res;
}
