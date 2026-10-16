import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AuditClient from "./AuditClient";

export default async function ChainPage() {
  if (!(await getSession())) redirect("/login");
  return <AuditClient />;
}
