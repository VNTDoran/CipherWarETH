import { notFound, redirect } from "next/navigation";
import { getModel } from "@/lib/admin-models";
import { getSession } from "@/lib/session";
import AdminCrud from "./AdminCrud";

export default async function AdminModelPage({
  params,
}: {
  params: Promise<{ model: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/lobby");

  const { model: key } = await params;
  const model = getModel(key);
  if (!model) notFound();

  // Only the serialisable half of the spec crosses into the client bundle —
  // the zod schemas and prisma delegates stay on the server.
  return (
    <AdminCrud
      spec={{
        key: model.key,
        label: model.label,
        description: model.description,
        readOnly: !!model.readOnly,
        affectsGameplay: !!model.affectsGameplay,
        fields: model.fields,
      }}
    />
  );
}
