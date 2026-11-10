import { currentAuth } from "@/lib/server-auth";
import { redirect } from "next/navigation";
import { AuthTabs } from "@/components/AuthTabs";
import { LandingPhrases } from "@/components/LandingPhrases";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const a = await currentAuth();
  if (a && !a.session.mfaPending) redirect("/dashboard");
  const { tab } = await searchParams;
  const initialTab: "signin" | "signup" | "reach" = tab === "signup" || tab === "reach" ? tab : "signin";
  return (
    <div className="landing">
      <div className="landing-in">
        <LandingPhrases />
        <AuthTabs initialTab={initialTab} />
      </div>
    </div>
  );
}
