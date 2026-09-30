import { NextResponse } from "next/server";
import { getModel } from "@/lib/admin-models";
import { getSession } from "@/lib/session";

const PAGE_SIZE = 20;

function guard(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ model: string }> },
) {
  const denied = guard(await getSession());
  if (denied) return denied;

  const { model: key } = await params;
  const model = getModel(key);
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 404 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const q = (url.searchParams.get("q") ?? "").trim();

  // SQLite has no case-insensitive `mode`, so searches are literal contains.
  const where =
    q && model.search?.length
      ? { OR: model.search.map((f) => ({ [f]: { contains: q } })) }
      : undefined;

  const delegate = model.delegate();
  const [rows, total] = await Promise.all([
    delegate.findMany({
      where,
      orderBy: model.orderBy,
      include: model.include,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    delegate.count({ where }),
  ]);

  return NextResponse.json({
    rows: rows.map(stripSecrets),
    total,
    page,
    pageSize: PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ model: string }> },
) {
  const denied = guard(await getSession());
  if (denied) return denied;

  const { model: key } = await params;
  const model = getModel(key);
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  if (model.readOnly || !model.createSchema)
    return NextResponse.json({ error: "This table is read-only" }, { status: 405 });

  const parsed = model.createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${issue?.path.join(".") ?? "input"}: ${issue?.message ?? "invalid"}` },
      { status: 400 },
    );
  }

  const data = model.transform
    ? await model.transform(parsed.data as Record<string, unknown>)
    : (parsed.data as Record<string, unknown>);

  try {
    const row = await model.delegate().create({ data });
    return NextResponse.json({ row: stripSecrets(row) }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002")
      return NextResponse.json({ error: "That value must be unique" }, { status: 409 });
    if (err?.code === "P2003")
      return NextResponse.json({ error: "Referenced record does not exist" }, { status: 400 });
    return NextResponse.json({ error: "Could not create the record" }, { status: 500 });
  }
}

function stripSecrets(row: Record<string, unknown>) {
  const { passwordHash, ...rest } = row ?? {};
  return rest;
}
