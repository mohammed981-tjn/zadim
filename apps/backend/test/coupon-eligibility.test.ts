/**
 * اختباراتُ أهليّة الكوبون — `modules/promotions/eligibility.ts`.
 *
 * ── ما تحرسه وما لا تحرسه ────────────────────────────────────────
 *
 * الانتهاءُ والحالةُ والحدُّ الكلّيُّ عند Medusa ومحروسةٌ بقفلِ صفٍّ
 * عنده — ومضاعفتُها هنا تُنتج جوابين لسؤالٍ واحد. فهذه تحرس **ما لا
 * يملكه المحرّك**: الحدَّ لكل عميل، وأوّلَ طلب، وسقفَ الخصم.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCoupon,
  orderByPriority,
  DEFAULT_PRIORITY,
  type CouponPolicy,
  type CouponContext,
} from "../src/modules/promotions/eligibility.ts";

const ctx = (o: Partial<CouponContext> = {}): CouponContext => ({
  redemptions_by_customer: 0,
  previous_orders: 0,
  computed_discount: 0,
  is_guest: false,
  ...o,
});

const policy = (o: Partial<CouponPolicy> = {}): CouponPolicy => ({
  per_customer_limit: null,
  max_discount: null,
  first_order_only: false,
  ...o,
});

test("بلا سياسةٍ عندنا ⇒ يعمل بحدود Medusa وحدَها", () => {
  // غيابُ الصفّ ليس منعاً — بخلاف COD، وهذا فرقٌ مقصود.
  assert.deepEqual(checkCoupon(null, ctx({ redemptions_by_customer: 99 })), { ok: true });
});

// ──────────────── الضيف ────────────────

test("🔴 الضيفُ أوّلاً — كلُّ ما بعده يحتاج هويّةً تُعدّ عليها", () => {
  // كوبونٌ بحدٍّ لكل عميل يُعطى لضيفٍ **بلا حدٍّ عملياً**: يُعاد
  // استعمالُه بلا نهاية لأن لا أحدَ يُعدّ عليه.
  for (const p of [policy({ per_customer_limit: 1 }), policy({ first_order_only: true })]) {
    const v = checkCoupon(p, ctx({ is_guest: true }));
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "SIGN_IN_REQUIRED");
  }
});

test("الضيفُ يمرّ حين لا تحتاج السياسةُ هويّة", () => {
  // سقفُ الخصم لا يحتاج عدّاً على عميل، فلا يُطالَب الضيفُ بالدخول بلا سبب.
  assert.deepEqual(checkCoupon(policy({ max_discount: 10000 }), ctx({ is_guest: true })), { ok: true });
});

// ──────────────── أوّلُ طلب ────────────────

test("«أوّلُ طلبٍ فقط» يُرفض لمن له طلبٌ سابق", () => {
  const v = checkCoupon(policy({ first_order_only: true }), ctx({ previous_orders: 1 }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.code, "FIRST_ORDER_ONLY");
  assert.equal(checkCoupon(policy({ first_order_only: true }), ctx()).ok, true, "ولا طلبَ سابقاً ⇒ يمرّ");
});

// ──────────────── الحدُّ لكل عميل ────────────────

test("🔴 الحدُّ لكل عميل: يُمنع عند بلوغه لا بعده", () => {
  const p = policy({ per_customer_limit: 2 });
  assert.equal(checkCoupon(p, ctx({ redemptions_by_customer: 1 })).ok, true);
  const v = checkCoupon(p, ctx({ redemptions_by_customer: 2 }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.code, "PER_CUSTOMER_LIMIT");
});

test("الرسالةُ تتغيّر حين يكون الحدُّ واحداً — «استعملتَه من قبل»", () => {
  const one = checkCoupon(policy({ per_customer_limit: 1 }), ctx({ redemptions_by_customer: 1 }));
  const many = checkCoupon(policy({ per_customer_limit: 3 }), ctx({ redemptions_by_customer: 3 }));
  assert.equal(one.ok, false);
  assert.equal(many.ok, false);
  if (one.ok || many.ok) return;
  assert.match(one.message_ar, /من قبل/);
  assert.match(many.message_ar, /3 مرّات/);
});

test("حدُّ صفرٍ يعني منعاً — لا «بلا حدّ»", () => {
  // `null` هو «بلا حدّ»، والصفرُ رقمٌ ضبطه المديرُ قصداً.
  assert.equal(checkCoupon(policy({ per_customer_limit: 0 }), ctx()).ok, false);
});

// ──────────────── سقفُ الخصم ────────────────

test("🔴 سقفُ الخصم يُرفض ولا يُقصّ — والسقفُ مذكورٌ بالريال", () => {
  // القصُّ يحتاج تعديلَ تسويّات Medusa سطراً سطراً بعد حسابها، وهو
  // قتالٌ مع المحرّك يُنتج رقمين مختلفين في السلّة والفاتورة.
  const v = checkCoupon(policy({ max_discount: 5000 }), ctx({ computed_discount: 5001 }));
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.code, "DISCOUNT_CAP");
    assert.match(v.message_ar, /50\.00 ريالاً/, "الهللاتُ تُعرض ريالاً — والرسالةُ تقول السقف");
  }
});

test("خصمٌ يساوي السقفَ بالضبط يمرّ", () => {
  assert.equal(checkCoupon(policy({ max_discount: 5000 }), ctx({ computed_discount: 5000 })).ok, true);
});

// ──────────────── ترتيبُ التطبيق ────────────────

test("🔴 orderByPriority: الأصغرُ أوّلاً، وما لا سياسةَ له يأخذ الافتراض", () => {
  // قِيس أن المحرّكَ يرتّب بقيمة الخصم تنازلياً لا كما تقول الوثيقة،
  // فالترتيبُ **المقرَّر عندنا** يُفرض هنا صراحةً.
  const out = orderByPriority(
    [{ code: "ج" }, { code: "أ" }, { code: "ب" }],
    (c) => ({ "أ": 50, "ب": 10 } as Record<string, number>)[c]
  );
  assert.deepEqual(out.map((x) => x.code), ["ب", "أ", "ج"]);
  assert.equal(DEFAULT_PRIORITY, 100, "والافتراضُ يقع بعد المضبوطِ صراحةً");
});

test("🔴 التعادلُ يُبقي ترتيبَ الإدخال — لا عشوائيةَ في المجموع", () => {
  // ترتيبٌ عشوائيٌّ عند التعادل يجعل **نفسَ السلّة تُنتج مجموعين
  // مختلفين في نداءين**.
  const codes = [{ code: "د" }, { code: "أ" }, { code: "ج" }, { code: "ب" }];
  const out = orderByPriority(codes, () => 7);
  assert.deepEqual(out.map((x) => x.code), ["د", "أ", "ج", "ب"]);
});

test("orderByPriority: لا يمسّ المصفوفةَ الأصلية", () => {
  const codes = [{ code: "ب" }, { code: "أ" }];
  orderByPriority(codes, (c) => (c === "أ" ? 1 : 2));
  assert.deepEqual(codes.map((x) => x.code), ["ب", "أ"]);
});
