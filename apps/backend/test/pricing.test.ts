/**
 * اختباراتُ معبر المال — `modules/checkout/pricing.ts`.
 *
 * ── لماذا هذا الملفُّ أوّلاً ───────────────────────────────────────
 *
 * كان في المستودع **صفرُ اختباراتِ وحدة**: الحراسةُ كلُّها في خمسٍ
 * وعشرين بوّابةً تحتاج Postgres حقيقيّةً وتأخذ دقائق. فمنطقُ التقريب
 * والفرق والتوازن — وهو **معبرُ المال الوحيد** (ADR-008 · ADR-034) —
 * لم يكن يحرسه فحصٌ يُشغَّل في ثانية.
 *
 * وليست هذه اختباراتِ تغطيةٍ تُكتب لتخضرّ: كلُّ حالةٍ هنا **عطبٌ وقع
 * فعلاً** ومسجَّلٌ في تعليقات الوحدة، أو ثابتٌ لو انكسر لَما لاحظه أحد.
 *
 * التشغيل: npm run test:unit   (بلا قاعدةٍ ولا حزمةٍ خارجية)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amount,
  rawAmount,
  priceDrift,
  fingerprint,
  totalsOf,
  rawTotalsOf,
  totalsBalance,
  type CartLine,
} from "../src/modules/checkout/pricing.ts";

// ───────────────────────── amount() ─────────────────────────

test("amount: الهللةُ عددٌ صحيح — والكسرُ يُقرَّب (ADR-008)", () => {
  assert.equal(amount(14373.85), 14374);
  assert.equal(amount(12900), 12900);
  assert.equal(amount(2.5), 3, "النصفُ يُقرَّب لأعلى");
});

test("amount: الغيابُ صفرٌ لا NaN — ورقمٌ بلا سعرٍ يكسر كلَّ حسابٍ بعده", () => {
  assert.equal(amount(null), 0);
  assert.equal(amount(undefined), 0);
});

test("amount: يقبل كائنَ BigNumber كما يأتي من طبقة الاستعلام", () => {
  // المبالغُ تعود كائناتٍ لا أعداداً، و`Number()` يمرّ على `valueOf`.
  // وبغير هذا كانت المقارنةُ بالهويّة **تكذب دائماً** (عطلٌ وقع فعلاً).
  assert.equal(amount({ valueOf: () => 14373.85 }), 14374);
  assert.equal(amount("12900"), 12900);
});

test("rawAmount: لا يقرّب — وهو ما يُفحص به الثابتُ الحسابيّ", () => {
  assert.equal(rawAmount(14373.85), 14373.85);
  assert.equal(rawAmount(null), 0);
});

// ───────────────────────── priceDrift() ─────────────────────────

const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: "li_1",
  variant_id: "var_1",
  title: "منتج",
  quantity: 1,
  unit_price: 9999,
  ...over,
});

test("priceDrift: سعرٌ لم يتغيّر ⇒ لا فرق", () => {
  const out = priceDrift([line()], new Map([["var_1", 9999]]));
  assert.deepEqual(out, []);
});

test("🔴 priceDrift: الحلقةُ التي لا تنتهي — عرضٌ مخزَّنٌ صحيحٌ مقابل حيٍّ كسريّ", () => {
  // العمودُ في القاعدة integer فيُقرَّب العرضُ عند الكتابة (14374)،
  // والسلّةُ الحيّةُ تعطي 14373.85. وقبل ADR-034 كانا يختلفان أبداً،
  // فمنتجُ ٩٩٫٩٩ ريالاً **لم يكن يُشترى من هذا المتجر إطلاقاً**.
  const out = priceDrift(
    [line({ unit_price: 14374 })],
    new Map([["var_1", 14373.85]])
  );
  assert.deepEqual(out, [], "التقريبُ عند معبرٍ واحدٍ يجعلهما يتّفقان بالضرورة لا بالحظّ");
});

test("priceDrift: ارتفع السعرُ ⇒ فرقٌ موجبٌ بمقداره", () => {
  const out = priceDrift([line({ unit_price: 12900 })], new Map([["var_1", 19350]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].quoted_unit_price, 12900);
  assert.equal(out[0].current_unit_price, 19350);
  assert.equal(out[0].difference, 6450);
});

test("priceDrift: انخفض السعرُ ⇒ فرقٌ سالب (ولا يمرّ صامتاً)", () => {
  const out = priceDrift([line({ unit_price: 12900 })], new Map([["var_1", 9900]]));
  assert.equal(out[0].difference, -3000);
});

test("priceDrift: سعرٌ سُحب ⇒ فرقٌ لا يُتجاهل", () => {
  // منتجٌ سُحب سعرُه لا يُباع بسعرٍ قديمٍ محفوظٍ في سلّة. ويُعرض
  // `current = 0` لأن الواجهة تعرض رقماً، والرسالةُ العربية تشرح.
  for (const missing of [undefined, null]) {
    const out = priceDrift([line()], new Map([["var_1", missing]]));
    assert.equal(out.length, 1, `الحالة: ${String(missing)}`);
    assert.equal(out[0].current_unit_price, 0);
    assert.equal(out[0].difference, -9999);
  }
  // ومتغيّرٌ غائبٌ عن الخريطة أصلاً — لا مفتاحَ له — مثلُه.
  const out = priceDrift([line()], new Map());
  assert.equal(out.length, 1);
});

test("priceDrift: يُبلَّغ عن السطر المتغيّر وحدَه لا عن السلّة كلِّها", () => {
  const out = priceDrift(
    [line({ id: "li_1", variant_id: "var_1" }), line({ id: "li_2", variant_id: "var_2" })],
    new Map([
      ["var_1", 9999],
      ["var_2", 12000],
    ])
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].line_id, "li_2");
});

// ───────────────────────── fingerprint() ─────────────────────────

test("fingerprint: لا يتأثّر بترتيب السطور", () => {
  const a = line({ id: "li_1", variant_id: "var_1" });
  const b = line({ id: "li_2", variant_id: "var_2", unit_price: 500 });
  assert.equal(fingerprint([a, b]), fingerprint([b, a]));
});

test("fingerprint: يفرّق «تغيّرت السلّة» عن «تغيّر السعر»", () => {
  // الحالتان تُبطلان العرضَ، والرسالةُ تختلف: «تغيّر السعر» لمن أضاف
  // صنفاً بنفسه تُربكه.
  const base = [line()];
  assert.notEqual(fingerprint(base), fingerprint([line({ quantity: 2 })]), "كمّيّة");
  assert.notEqual(fingerprint(base), fingerprint([line({ unit_price: 12900 })]), "سعر");
  assert.notEqual(
    fingerprint(base),
    fingerprint([line(), line({ id: "li_2", variant_id: "var_2" })]),
    "صنفٌ مضاف"
  );
});

test("fingerprint: يقرّب السعرَ كما يقرّبه العرض — فلا تُبطله هللةٌ كسريّة", () => {
  assert.equal(fingerprint([line({ unit_price: 14374 })]), fingerprint([line({ unit_price: 14373.85 })]));
});

// ───────────────────────── المجاميع والتوازن ─────────────────────────

const cart = (o: Record<string, unknown> = {}) => ({
  currency_code: "sar",
  item_total: 12900,
  shipping_total: 2000,
  tax_total: 1935,
  discount_total: 0,
  total: 14900,
  ...o,
});

test("totalsOf: يقرّب كلَّ حقلٍ — وrawTotalsOf لا يقرّب شيئاً", () => {
  const c = cart({ item_total: 11488.5, shipping_total: 2298.85, total: 13787.35 });
  assert.equal(totalsOf(c).item_total, 11489);
  assert.equal(rawTotalsOf(c).item_total, 11488.5);
  assert.equal(totalsOf(c).currency_code, "sar");
});

test("totalsOf: سلّةٌ غائبةٌ ⇒ أصفارٌ لا NaN", () => {
  const t = totalsOf(undefined);
  assert.deepEqual(t, {
    currency_code: "",
    item_total: 0,
    shipping_total: 0,
    tax_total: 0,
    discount_total: 0,
    total: 0,
  });
});

test("totalsBalance: بندٌ + شحنٌ = المجموع ⇒ متوازن بفرقٍ صفر", () => {
  const r = totalsBalance(rawTotalsOf(cart()));
  assert.equal(r.ok, true);
  assert.equal(r.diff, 0);
});

test("🔴 totalsBalance: يُفحص على الخام لا على المقرَّب — وإلا مُنع بيعٌ مشروع", () => {
  // منتجٌ بـ٩٩٫٩٠ وشحنٌ بـ١٩٫٩٩ بضريبة ١٥٪ — إحدى اثنتَي عشرةَ تركيبةً
  // من ١٠٥ مقيسةٍ تجعل round(س) + round(ص) ≠ round(س+ص) بهللةٍ واحدة.
  const c = cart({ item_total: 11488.5, shipping_total: 2298.85, total: 13787.35 });

  const onRaw = totalsBalance(rawTotalsOf(c));
  assert.equal(onRaw.ok, true, "الثابتُ الحسابيُّ يصحّ بالضبط على أرقام Medusa الخام");

  const onRounded = totalsBalance(totalsOf(c));
  assert.equal(onRounded.ok, false);
  assert.equal(onRounded.diff, -1, "وفحصُه على المقرَّب يقيس ضجيجَ التقريب لا صحّةَ الحساب");
});

test("totalsBalance: اختلالٌ حقيقيٌّ يُبلَّغ بمقداره — والتسامحُ صفر", () => {
  // فرقُ هللةٍ في متجرٍ يبيع مليوناً عشرةُ آلافِ ريالٍ لا يعرف أحدٌ أين ذهبت.
  const r = totalsBalance(rawTotalsOf(cart({ total: 14901 })));
  assert.equal(r.ok, false);
  assert.equal(r.expected, 14900);
  assert.equal(r.diff, 1);
});
