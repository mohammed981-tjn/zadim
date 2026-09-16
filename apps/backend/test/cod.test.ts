/**
 * اختباراتُ الدفع عند الاستلام — `modules/payments/cod.ts`.
 *
 * ── لماذا تُحرَس ─────────────────────────────────────────────────
 *
 * لأن **الافتراضَ فيها منعٌ لا سماح**: تفعيلُ وسيلةِ دفعٍ بمخاطرةٍ
 * تشغيليةٍ قرارُ مالكٍ صريح، وغيابُ الصفّ ليس موافقة. وانقلابُ هذا
 * الافتراض لا يُحدث خطأً يُرى — يفتح البابَ صامتاً.
 *
 * ولا رقمَ مبرمَجاً فيها (بند ٤٨): كلُّ حدٍّ يأتي من السياسة، وسياسةٌ
 * بلا حدٍّ تعني «بلا حدّ» لا «الحدُّ الافتراضيّ كذا».
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { customerKey, codEligibility, type CodPolicyInput } from "../src/modules/payments/cod.ts";

const on: CodPolicyInput = { is_enabled: true };

// ──────────────── مفتاحُ العميل ────────────────

test("🔴 customerKey: رقمٌ واحدٌ بثلاث صورٍ ⇒ مفتاحٌ واحد", () => {
  // وبلا توحيدها يفلت الممنوعُ من المنع **بتغيير صيغة الكتابة وحدها**.
  const k = customerKey({ phone: "0501234567" });
  for (const p of ["+966 50 123 4567", "00966501234567", "٠٥٠١٢٣٤٥٦٧", "966501234567", "501234567"]) {
    assert.equal(customerKey({ phone: p }), k, `الصيغة: ${p}`);
  }
  assert.equal(k, "501234567", "آخرُ تسعةٍ — تُسقط 966 و00966 والصفرَ المحلّي");
});

test("customerKey: بلا جوّالٍ ⇒ البريدُ مطبَّعاً", () => {
  assert.equal(customerKey({ email: "  A@B.COM " }), "a@b.com");
  assert.equal(customerKey({ phone: "", email: "A@B.com" }), "a@b.com");
  assert.equal(customerKey({ phone: "0501234567", email: "a@b.com" }), "501234567", "الجوّالُ يسبق");
  assert.equal(customerKey({}), "");
});

// ──────────────── الافتراضُ منع ────────────────

test("🔴 لا سياسةَ ⇒ لا COD — وغيابُ الصفّ ليس موافقة", () => {
  for (const p of [null, undefined]) {
    const d = codEligibility({ policy: p, order_total: 10000 });
    assert.equal(d.eligible, false);
    if (!d.eligible) assert.equal(d.code, "COD_DISABLED");
  }
});

test("مُطفأةٌ صراحةً ⇒ ممنوع", () => {
  const d = codEligibility({ policy: { is_enabled: false }, order_total: 10000 });
  assert.equal(d.eligible, false);
  if (!d.eligible) assert.equal(d.code, "COD_DISABLED");
});

test("مفعَّلةٌ بلا حدودٍ ⇒ مسموح", () => {
  assert.equal(codEligibility({ policy: on, order_total: 999999 }).eligible, true);
});

// ──────────────── الحدود — والحافّةُ تُقاس ────────────────

test("🔴 الحدُّ الأعلى: الحافّةُ مسموحةٌ وما فوقها ممنوع", () => {
  // «أكبرُ من» لا «أكبرُ أو يساوي»: طلبٌ يساوي الحدَّ بالضبط مسموحٌ،
  // وعكسُه يمنع بيعاً مشروعاً بهللةٍ واحدة.
  const p: CodPolicyInput = { is_enabled: true, max_order_total: 100000 };
  assert.equal(codEligibility({ policy: p, order_total: 100000 }).eligible, true, "يساوي الحدَّ");
  const over = codEligibility({ policy: p, order_total: 100001 });
  assert.equal(over.eligible, false);
  if (!over.eligible) assert.equal(over.code, "COD_ABOVE_LIMIT");
});

test("الحدُّ الأدنى: الحافّةُ مسموحةٌ وما دونها ممنوع", () => {
  const p: CodPolicyInput = { is_enabled: true, min_order_total: 5000 };
  assert.equal(codEligibility({ policy: p, order_total: 5000 }).eligible, true);
  const under = codEligibility({ policy: p, order_total: 4999 });
  assert.equal(under.eligible, false);
  if (!under.eligible) assert.equal(under.code, "COD_BELOW_MINIMUM");
});

test("حدٌّ غيرُ مضبوطٍ لا يُفحص — ولا يصير صفراً", () => {
  const p: CodPolicyInput = { is_enabled: true, max_order_total: null, min_order_total: null };
  assert.equal(codEligibility({ policy: p, order_total: 0 }).eligible, true);
  assert.equal(codEligibility({ policy: p, order_total: 10 ** 9 }).eligible, true);
});

// ──────────────── المدنُ المستثناة ────────────────

test("مدينةٌ مستثناةٌ تُمنع — والمسافاتُ لا تُنجّي", () => {
  const p: CodPolicyInput = { is_enabled: true, excluded_cities: ["  جدة "] };
  const d = codEligibility({ policy: p, order_total: 1000, city: " جدة  " });
  assert.equal(d.eligible, false);
  if (!d.eligible) assert.equal(d.code, "COD_CITY_EXCLUDED");
  assert.equal(codEligibility({ policy: p, order_total: 1000, city: "الرياض" }).eligible, true);
});

test("بلا مدينةٍ لا يُفحص الاستثناء", () => {
  const p: CodPolicyInput = { is_enabled: true, excluded_cities: [""] };
  assert.equal(codEligibility({ policy: p, order_total: 1000 }).eligible, true);
  assert.equal(codEligibility({ policy: p, order_total: 1000, city: "   " }).eligible, true);
});

// ──────────────── الرفضاتُ المتراكمة ────────────────

test("🔴 الحظرُ عند بلوغ عدد الرفضات لا بعده", () => {
  // «أكبرُ أو يساوي»: ثلاثُ رفضاتٍ وحدُّها ثلاثٌ ⇒ محظور. وعكسُه يعطي
  // العميلَ رفضةً رابعةً مجّاناً.
  const p: CodPolicyInput = { is_enabled: true, refusals_before_block: 3 };
  assert.equal(codEligibility({ policy: p, order_total: 1000, refusals: 2 }).eligible, true);
  const blocked = codEligibility({ policy: p, order_total: 1000, refusals: 3 });
  assert.equal(blocked.eligible, false);
  if (!blocked.eligible) assert.equal(blocked.code, "COD_CUSTOMER_BLOCKED");
  assert.equal(codEligibility({ policy: p, order_total: 1000 }).eligible, true, "بلا رفضاتٍ ⇒ صفر");
});

test("كلُّ رفضٍ يحمل سبباً عربياً مفهوماً", () => {
  const d = codEligibility({ policy: null, order_total: 1 });
  assert.equal(d.eligible, false);
  if (!d.eligible) assert.ok(d.reason_ar.length > 10 && /[؀-ۿ]/.test(d.reason_ar));
});
