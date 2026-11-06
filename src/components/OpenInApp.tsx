"use client";
import { useEffect, useState } from "react";

/**
 * On a phone, offers to open this code or invite in the PryingEyes app (with the code already
 * filled in). If the app is installed with App Links / Universal Links set up, the phone opens
 * it before this page loads; this banner covers the other cases.
 */
export function OpenInApp({ path, downloadUrl }: { path: string; downloadUrl?: string | null }) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => { setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)); }, []);
  if (!mobile) return null;
  return (
    <div className="open-app" role="region" aria-label="PryingEyes app">
      <span className="small">Have the PryingEyes app?</span>
      <a className="btn sm" href={`pryingeyes://${path}`} data-testid="open-in-app">Open in the app</a>
      {downloadUrl ? <a className="small" href={downloadUrl}>Get the app</a> : null}
    </div>
  );
}
