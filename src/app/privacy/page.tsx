export const metadata = { title: "Privacy notice" };

export default function Privacy() {
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <h1>Privacy notice (plain language)</h1>
      <div className="card stack">
        <p><b>What PryingEyes is for.</b> You share a code instead of your phone number. People who want to reach you go through a gate you control.</p>
        <h2>What we keep</h2>
        <ul>
          <li>Your account: handle, email (to sign you in) and your second factor, if you set one up.</li>
          <li>The numbers you protect — <b>encrypted</b>. We never put them in logs, analytics or emails.</li>
          <li>Codes you create — only as one-way fingerprints. Even we can't read them back, so copy them when you make them.</li>
          <li>An activity log of every request to your codes: kept 12 months by default; you can choose 1–24 months.</li>
          <li>Chat messages — encrypted at rest. On Tier 3 codes they disappear after 24 hours.</li>
          <li>One-time email codes and human-check results — deleted within 90 days.</li>
        </ul>
        <h2>If you contact someone (callers)</h2>
        <p>The person you're contacting sees <b>your handle, how you were verified (for example "email code"), your country or region, and the outcome</b> of each request. They never see your phone number: calls happen in the app, over the internet. If they export an evidence pack, those details are included.</p>
        <h2>What we never do</h2>
        <ul><li>Sell your data or use it for advertising.</li><li>Record calls.</li><li>Scan your messages.</li><li>Share data except through a documented lawful-request process.</li></ul>
        <h2>Your rights</h2>
        <p>Download everything we hold about you, or delete your account, from Settings. Deletion is immediate on our live systems and reaches backups within 35 days. PryingEyes is for people aged 18 and over.</p>
        <p className="muted small">Controls are mapped to the Eswatini Data Protection Act 2022, the Botswana Data Protection Act 2024, South Africa's POPIA and the EU GDPR. This notice is a pre-launch draft pending legal review.</p>
      </div>
    </div>
  );
}
