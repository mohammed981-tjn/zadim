/**
 * اختباراتُ أهليّة الإرجاع — `modules/returns/policy.ts`.
 *
 * ── وما تحرسه ثلاثةٌ لا يُخلط بينها ──────────────────────────────
 *
 * ١. **غيابُ السياسة منعٌ** — قبولُ مرتجعٍ التزامٌ ماليٌّ وتشغيليّ لا
 *    يُلتزَم به لأن أحداً نسي أن يملأ استمارة.
 * ٢. **وغيابُ النافذة سماحٌ** — المديرُ فعّل الإرجاعَ صراحةً، ولو أراد
 *    تقييدَه بمدّةٍ لكتبها. والصمتان مختلفان، ولا يُوحَّدان.
 * ٣. **والمدّةُ بالأيام الكاملة** — لا بالميلي ثانية.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { returnEligibility, type ReturnPolicyInput } from "../src/modules/returns/policy.ts";

const on: ReturnPolicyInput = { is_enabled: true };
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

test("🔴 لا سياسةَ ⇒ لا إرجاع — والافتراضُ منعٌ لا سماح", () => {
  for (const p of [null, undefined, { is_enabled: false }]) {
    const d = returnEligibility({ policy: p, delivered_at: D("2026-09-01") });
    assert.equal(d.eligible, false);
    assert.equal(d.code, "RETURNS_DISABLED");
  }
});

test("🔴 لا إرجاعَ لما لم يُسلَّم", () => {
  // مرتجعٌ لبضاعةٍ في الطريق يفتح استرداداً لشيءٍ سيصل بعد ساعتين،
  // فيُخصم مرّتين ويُشحن مرّتين.
  for (const at of [null, undefined, ""]) {
    const d = returnEligibility({ policy: on, delivered_at: at });
    assert.equal(d.eligible, false);
    assert.equal(d.code, "NOT_DELIVERED");
  }
});

test("🔴 غيابُ النافذة سماحٌ — وهو صمتٌ غيرُ صمتِ غياب السياسة", () => {
  const d = returnEligibility({
    policy: { is_enabled: true, window_days: null },
    delivered_at: D("2020-01-01"),
    now: D("2026-09-16"),
  });
  assert.equal(d.eligible, true);
  assert.equal(d.days_left, undefined, "بلا نافذةٍ لا عدَّ أيامٍ يُعرض");
});

test("🔴 الحدُّ شاملٌ لا حاجز — اليومُ الرابعَ عشرَ من نافذةِ ١٤ يمرّ", () => {
  // من قرأ «١٤ يوماً» فهم أن اليوم الرابعَ عشرَ له.
  const p: ReturnPolicyInput = { is_enabled: true, window_days: 14 };
  const delivered = D("2026-09-01");

  const day14 = returnEligibility({ policy: p, delivered_at: delivered, now: D("2026-09-15") });
  assert.equal(day14.eligible, true);
  assert.equal(day14.days_left, 0, "آخرُ يومٍ — ولا يزال مقبولاً");

  const day15 = returnEligibility({ policy: p, delivered_at: delivered, now: D("2026-09-16") });
  assert.equal(day15.eligible, false);
  assert.equal(day15.code, "WINDOW_EXPIRED");
  assert.equal(day15.days_left, 0);
  assert.match(day15.reason_ar!, /14/, "والمدّةُ مذكورةٌ في الرسالة لا مخفيّة");
});

test("🔴 يُقاس بالأيام الكاملة لا بالساعات", () => {
  // لو قُورنت الطوابعُ مباشرةً لصار من استلم في الثانية ٥٩ من اليوم
  // الرابعَ عشرَ مرفوضاً ومن استلم قبله بدقيقةٍ مقبولاً — فرقٌ لا
  // يُشرح لعميل.
  const p: ReturnPolicyInput = { is_enabled: true, window_days: 1 };
  const lateNight = new Date("2026-09-01T23:59:59.000Z");
  const nextMorning = new Date("2026-09-02T00:00:01.000Z");
  const d = returnEligibility({ policy: p, delivered_at: lateNight, now: nextMorning });
  assert.equal(d.eligible, true);
  assert.equal(d.days_left, 0, "ثانيتان بينهما ⇒ يومٌ واحدٌ كامل");
});

test("days_left يتناقص يوماً بيوم — وهو ما تعرضه الواجهة", () => {
  const p: ReturnPolicyInput = { is_enabled: true, window_days: 7 };
  const delivered = D("2026-09-01");
  assert.equal(returnEligibility({ policy: p, delivered_at: delivered, now: D("2026-09-01") }).days_left, 7);
  assert.equal(returnEligibility({ policy: p, delivered_at: delivered, now: D("2026-09-04") }).days_left, 4);
});

test("التاريخُ يُقبل نصّاً كما يُقبل كائناً", () => {
  const p: ReturnPolicyInput = { is_enabled: true, window_days: 30 };
  const d = returnEligibility({ policy: p, delivered_at: "2026-09-01T10:00:00.000Z", now: D("2026-09-05") });
  assert.equal(d.eligible, true);
  assert.equal(d.days_left, 26);
});

test("صنفٌ مستثنىً يُرفض ولو كان بقيّةُ الطلب مقبولاً", () => {
  const p: ReturnPolicyInput = { is_enabled: true, excluded_category_ids: ["cat_underwear"] };
  const d = returnEligibility({
    policy: p,
    delivered_at: D("2026-09-01"),
    category_ids: ["cat_shoes", "cat_underwear"],
  });
  assert.equal(d.eligible, false);
  assert.equal(d.code, "CATEGORY_EXCLUDED");
  assert.equal(
    returnEligibility({ policy: p, delivered_at: D("2026-09-01"), category_ids: ["cat_shoes"] }).eligible,
    true
  );
});

test("المفتوحُ يُرفض حين تمنعه السياسةُ صراحةً فقط", () => {
  const delivered = D("2026-09-01");
  const strict = returnEligibility({
    policy: { is_enabled: true, accepts_opened: false },
    delivered_at: delivered,
    is_opened: true,
  });
  assert.equal(strict.eligible, false);
  assert.equal(strict.code, "OPENED_NOT_ACCEPTED");

  // وسياسةٌ ساكتةٌ عن الفتح لا تمنع — الصمتُ هنا سماحٌ أيضاً.
  assert.equal(
    returnEligibility({ policy: on, delivered_at: delivered, is_opened: true }).eligible,
    true
  );
});

test("الحدُّ الأدنى للإرجاع: الحافّةُ مقبولةٌ وما دونها مرفوض", () => {
  const p: ReturnPolicyInput = { is_enabled: true, min_order_total: 5000 };
  const delivered = D("2026-09-01");
  assert.equal(returnEligibility({ policy: p, delivered_at: delivered, order_total: 5000 }).eligible, true);
  const under = returnEligibility({ policy: p, delivered_at: delivered, order_total: 4999 });
  assert.equal(under.eligible, false);
  assert.equal(under.code, "BELOW_MINIMUM");
  // ومجموعٌ لم يُمرَّر أصلاً لا يُفحص — لا يُفترض صفراً فيُرفض كلُّ طلب.
  assert.equal(returnEligibility({ policy: p, delivered_at: delivered }).eligible, true);
});

test("ترتيبُ الرفض: «لم يُسلَّم» يسبق كلَّ شرطٍ آخر", () => {
  const d = returnEligibility({
    policy: { is_enabled: true, window_days: 1, excluded_category_ids: ["c"] },
    delivered_at: null,
    category_ids: ["c"],
  });
  assert.equal(d.code, "NOT_DELIVERED", "السببُ الأوّلُ هو الذي يُقال للعميل");
});
