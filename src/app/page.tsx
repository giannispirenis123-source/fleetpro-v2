// src/app/page.tsx
// Η ρίζα «/» δεν έχει δική της σελίδα: οδηγεί εκεί που ανήκει ο χρήστης.
// (Το link του preview στο GitHub/Vercel ανοίγει τη ρίζα — πριν έδινε 404
// «This page could not be found» σε όποιον ήταν ήδη συνδεδεμένος.)
// Χωρίς συνεδρία το middleware στέλνει ήδη στο /login.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(session.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard");
}
