import { NextResponse } from "next/server";
import { getModel } from "@/lib/admin-models";
import { getSession } from "@/lib/session";

async function guard() {
  const session = await getSession();
  if (!session) return { res: NextResponse.json({ error: "Sign in first" }, { status: 401 }), session: null };
  if (session.role !== "ADMIN")
    return { res: NextResponse.json({ error: "Admin access required" }, { status: 403 }), session: null };
  return { res: null, session };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ model: string; id: string }> },
) {
  const { res } = await guard();
  if (res) return res;

  const { model: key, id } = await params;
  const model = getModel(key);
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 404 });

  const row = await model.delegate().findUnique({ where: { id }, include: model.include });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { passwordHash, ...rest } = row;
  return NextResponse.json({ row: rest });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ model: string; id: string }> },
) {
  const { res } = await guard();
  if (res) return res;

  const { model: key, id } = await params;
  const model = getModel(key);
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  if (model.readOnly || !model.updateSchema)
    return NextResponse.json({ error: "This table is read-only" }, { status: 405 });

  const parsed = model.updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${issue?.path.join(".") ?? "input"}: ${issue?.message ?? "invalid"}` },
      { status: 400 },
    );
  }

  let data = parsed.data as Record<string, unknown>;
  if (model.transform) data = await model.transform(data);
  // Drop keys the caller left blank so a partial form never nulls a column.
  for (const k of Object.keys(data)) {
    if (data[k] === undefined || data[k] === "") delete data[k];
  }

  try {
    const row = await model.delegate().update({ where: { id }, data });
    const { passwordHash, ...rest } = row;
    return NextResponse.json({ row: rest });
  } catch (err: any) {
    if (err?.code === "P2002")
      return NextResponse.json({ error: "That value must be unique" }, { status: 409 });
    if (err?.code === "P2025")
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not update the record" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ model: string; id: string }> },
) {
  const { res, session } = await guard();
  if (res) return res;

  const { model: key, id } = await params;
  const model = getModel(key);
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 404 });

  // Deleting yourself would lock you out of the only admin screen.
  if (key === "users" && id === session?.sub)
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });

  try {
    await model.delegate().delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025")
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      { error: "Could not delete — other records still reference it" },
      { status: 409 },
    );
  }
}
