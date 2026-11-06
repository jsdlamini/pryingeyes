import { describe, expect, it } from "vitest";
import { findContactInfo } from "@/lib/guard";

const blocked: [string, string][] = [
  ["Call me on 7612 3456", "phone"],
  ["whatsapp +268 7612 3456", "phone"],
  ["76.12.34.56 after 5", "phone"],
  ["7-6-1-2-3-4-5-6", "phone"],
  ["seven six one two three four five six", "phone"],
  ["seven 6 one 2 three 4 five 6", "phone"],
  ["76 double one 23 45", "phone"],
  ["76l2 345O", "phone"],
  ["７６１２３４５６", "phone"],
  ["+27 82 123 4567", "phone"],
  ["(011) 555-0199", "phone"],
  ["mail thandi.d@gmail.com", "email"],
  ["thandi at gmail dot com", "email"],
  ["thandi [at] gmail [dot] co [dot] sz", "email"],
  ["https://wa.me/26876123456", "messaging_link"],
  ["join t.me/mygroup", "messaging_link"],
];
const allowed = [
  "Selling a fridge, E1,500, collect in Manzini",
  "Meeting on 2026-11-05 at 14:30",
  "Meeting on 05/11/2026",
  "Room 204, 3rd floor",
  "Tap my code: 7K3QX-9MPRT",
  "My link https://pryingeyes.test/t/7K3Q-X9MP-RT4A-B2CD",
  "Population 1.2 million",
  "I'll be one minute, then two more",
  "Code is ABCDE-12345 ok",
];

describe("contact-details guard", () => {
  it.each(blocked)("blocks %s", (text, kind) => { expect(findContactInfo(text)).toContain(kind); });
  it.each(allowed)("allows %s", (text) => { expect(findContactInfo(text)).toEqual([]); });
});
