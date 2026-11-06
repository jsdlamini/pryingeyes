import Link from "next/link";
import { currentAuth } from "@/lib/server-auth";
import { NavLinks } from "./NavLinks";
import { IncomingCall } from "./calls/IncomingCall";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

export async function Shell() {
  const a = await currentAuth();
  const signedIn = a && !a.session.mfaPending;
  const roles = a?.user.roles ?? [];
  return (
    <header className="topbar">
      <div className="in">
        <Link href={signedIn ? "/dashboard" : "/"} className="logo"><Icon name="mark" size={24} /><span>Prying<b>Eyes</b></span></Link>
        {signedIn ? (
          <NavLinks handle={a!.user.handle} moderator={roles.includes("moderator") || roles.includes("admin")} admin={roles.includes("admin")} />
        ) : (
          <nav className="nav" aria-label="Main"><span style={{ flex: 1 }} /><Link href="/login">Sign in</Link><Link href="/signup">Create account</Link></nav>
        )}
        <ThemeToggle />
      </div>
      {signedIn && <IncomingCall />}
    </header>
  );
}
