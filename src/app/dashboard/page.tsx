import { requirePageAuth } from "@/lib/server-auth";
import { DashboardClient } from "./DashboardClient";

export const metadata = { title: "My codes" };

/** Everyone can create codes straight away. A phone number is an optional extra (see /onboarding). */
export default async function DashboardPage() {
  await requirePageAuth("/dashboard");
  return <DashboardClient />;
}
