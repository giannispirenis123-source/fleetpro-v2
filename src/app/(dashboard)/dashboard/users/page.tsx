import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { USER_SELECT, toUserDTO } from "@/lib/users";
import { checkWithinLimit } from "@/lib/entitlements";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const guard = await pageGuard("users.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const [users, limit] = await Promise.all([
    db.user.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: USER_SELECT,
    }),
    checkWithinLimit(session.tenantId, "users"),
  ]);

  return (
    <UsersClient
      initialUsers={users.map(toUserDTO)}
      currentUserId={viewer.userId}
      canCreate={viewer.role === "COMPANY_ADMIN"}
      limitMessage={limit.ok ? null : limit.message}
    />
  );
}
