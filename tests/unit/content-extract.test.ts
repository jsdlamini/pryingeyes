import { describe, expect, it } from "vitest";
import { extractItems, findDeadline } from "@/lib/content";

describe("findDeadline", () => {
  it("finds a deadline with 'deadline' word", () => {
    expect(findDeadline("Applications close. Deadline: 30 June 2026. Late entries rejected.")?.toISOString()).toBe("2026-06-30T23:59:59.000Z");
  });
  it("finds an ISO date after 'apply by'", () => {
    expect(findDeadline("Apply by 2026-03-15.")?.toISOString()).toBe("2026-03-15T23:59:59.000Z");
  });
  it("finds a 'closing date' in month-first form", () => {
    expect(findDeadline("Closing date: March 5, 2026.")?.toISOString()).toBe("2026-03-05T23:59:59.000Z");
  });
  it("returns null when no deadline", () => {
    expect(findDeadline("A regular notice with no date.")).toBeNull();
  });
});

describe("extractItems", () => {
  it("parses RSS items", () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Graduate trainee</title><link>https://example.gov.sz/jobs/1</link><description>Apply now. Deadline: 31 Dec 2026.</description></item><item><title>Bursary</title><link>https://example.gov.sz/jobs/2</link><description>Scholarship for S1.</description></item></channel></rss>`;
    const items = extractItems(rss, "application/rss+xml", { id: "x", category: "job", country: "SZ", rules: null });
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Graduate trainee");
    expect(items[0].url).toBe("https://example.gov.sz/jobs/1");
    expect(items[0].deadline?.toISOString()).toBe("2026-12-31T23:59:59.000Z");
    expect(items[1].title).toBe("Bursary");
  });

  it("treats an HTML page as a single notice", () => {
    const html = `<html><head><title>Road works in Mbabane</title></head><body><h1>Road works in Mbabane</h1><p>Expect delays until 2026-02-01.</p></body></html>`;
    const items = extractItems(html, "text/html", { id: "x", category: "service_notice", country: "SZ", rules: null });
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Road works");
    expect(items[0].body).toContain("delays");
  });

  it("splits an HTML listing with an itemRegex rule", () => {
    const html = `<ul><li><a href="/j/1">Clerk</a> Deadline 30 Apr 2026</li><li><a href="/j/2">Driver</a></li></ul>`;
    const items = extractItems(html, "text/html", { id: "x", category: "job", country: "SZ", rules: JSON.stringify({ itemRegex: "<li[^>]*>[\\s\\S]*?<\\/li>" }) });
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe("/j/1");
    expect(items[1].title).toContain("Driver");
  });
});
