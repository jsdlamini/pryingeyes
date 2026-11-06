import { requirePageAuth } from "@/lib/server-auth";
import { env } from "@/lib/env";
import { JoinGroup } from "./JoinGroup";
import { OpenInApp } from "@/components/OpenInApp";

export const metadata = { title: "Join a group", referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ invite: string }> }) {
  const { invite } = await params;
  await requirePageAuth(`/g/${invite}`);
  return <div className="narrow"><OpenInApp path={`g/${invite}`} downloadUrl={env().APP_DOWNLOAD_URL || null} /><JoinGroup invite={decodeURIComponent(invite)} /></div>;
}
