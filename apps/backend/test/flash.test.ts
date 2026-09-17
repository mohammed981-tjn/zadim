/**
 * اختباراتُ حالة التخفيض الخاطف — `modules/promotions/flash.ts`.
 *
 * ── وما تحرسه بالضبط ────────────────────────────────────────────
 *
 * `flashState()` **للعرض لا للحكم**: منها يُرسم العدّادُ التنازليّ،
 * والقبولُ أو الرفضُ يقع في القاعدة عند الإتمام.
 *
 * وخطرُها أن تفترق عمّا يفحصه المُطلِق: لو عدّت هذه اللحظةَ الأخيرةَ
 * «جارياً» والمُطلِقُ يعدّها منتهياً، لرأى العميلُ عدّاداً يعمل وطلباً
 * يُرفض — وهي أسوأُ من رفضٍ صريح.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { flashState, type FlashSaleRow } from "../src/modules/promotions/flash.ts";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const sale = (from: string, to: string, is_active = true): FlashSaleRow => ({
  id: "f",
  promotion_id: "p",
  promotion_code: "C",
  starts_at: new Date(from),
  ends_at: new Date(to),
  quantity_limit: null,
  per_customer_limit: null,
  is_active,
});

test("الإطفاءُ يسبق كلَّ شيء — ولو كانت النافذةُ جارية", () => {
  const s = flashState(sale("2026-09-17T11:00:00Z", "2026-09-17T13:00:00Z", false), NOW);
  assert.equal(s.phase, "inactive");
});

test("لم يبدأ ⇒ upcoming ومعه كم بقي للبداية", () => {
  const s = flashState(sale("2026-09-17T13:00:00Z", "2026-09-17T14:00:00Z"), NOW);
  assert.equal(s.phase, "upcoming");
  if (s.phase === "upcoming") assert.equal(s.starts_in_ms, 3600_000);
});

test("جارٍ ⇒ live ومعه كم بقي للنهاية", () => {
  const s = flashState(sale("2026-09-17T11:00:00Z", "2026-09-17T13:00:00Z"), NOW);
  assert.equal(s.phase, "live");
  if (s.phase === "live") assert.equal(s.ends_in_ms, 3600_000);
});

test("🔴 النهايةُ حصريّةٌ — كما يفحصها المُطلِق بـ`now() >= ends_at`", () => {
  // لو كانت شاملةً هنا وحصريّةً هناك، لرأى العميلُ عدّاداً يعمل وطلباً
  // يُرفض في اللحظة نفسِها.
  assert.equal(flashState(sale("2026-09-17T11:00:00Z", "2026-09-17T12:00:00Z"), NOW).phase, "ended");
});

test("البدايةُ شاملة — أوّلُ لحظةٍ داخل العرض", () => {
  assert.equal(flashState(sale("2026-09-17T12:00:00Z", "2026-09-17T13:00:00Z"), NOW).phase, "live");
});

test("انتهى ⇒ ended", () => {
  assert.equal(flashState(sale("2026-09-17T09:00:00Z", "2026-09-17T10:00:00Z"), NOW).phase, "ended");
});

test("التواريخُ تُقبل نصّاً كما تُقبل كائنات", () => {
  const s = flashState(
    { ...sale("2026-09-17T11:00:00Z", "2026-09-17T13:00:00Z"), starts_at: "2026-09-17T11:00:00Z", ends_at: "2026-09-17T13:00:00Z" },
    NOW
  );
  assert.equal(s.phase, "live");
});
