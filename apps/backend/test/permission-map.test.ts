/**
 * اختباراتُ خريطة الصلاحيات — `modules/access/permission-map.ts`.
 *
 * ── لماذا هذه ثانيةً بعد معبر المال ───────────────────────────────
 *
 * لأنها **حارسُ الرفض الافتراضيّ**: ما لا يجد صلاحيتَه فيها يُرفض.
 * وخطرُها أن عطبَها **صامت** — لا يسقط طلبٌ ولا يظهر خطأ، بل يمرّ ما
 * كان يجب أن يُمنع. وقد وقع ذلك ثلاث مرّاتٍ مسجَّلةٍ في تعليقات الملفّ،
 * وكلُّ بوّاباته خضراء في كلٍّ منها.
 *
 * فكلُّ اختبارٍ هنا يقابل عطباً وقع، لا حالةً متخيَّلة.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ROUTE_RULES,
  EXEMPT,
  ruleFor,
  isExempt,
  readField,
  readCount,
} from "../src/modules/access/permission-map.ts";

// ──────────────── الرفضُ الافتراضيّ ────────────────

test("🔴 مسارٌ لا قاعدةَ له ⇒ null — فالنسيانُ يُغلق البابَ لا يفتحه", () => {
  assert.equal(ruleFor("/مسار-لم-يُكتب-بعد", "POST"), null);
  assert.equal(ruleFor("/products/batch/secret", "POST"), null);
});

test("الطريقةُ جزءٌ من المطابقة — لا يكفي أن يطابق المسار", () => {
  // قراءةُ المنتجات مسموحةٌ بـGET، والحذفُ صلاحيةٌ أخرى تماماً.
  assert.equal(ruleFor("/products/prod_1", "GET")?.permission, "products.read");
  assert.equal(ruleFor("/products/prod_1", "DELETE")?.permission, "products.delete");
  assert.equal(ruleFor("/products", "DELETE"), null, "لا حذفَ جماعيٌّ بلا قاعدة");
});

test("الطريقةُ تُقبل بأيّ حالةِ أحرف", () => {
  assert.equal(ruleFor("/products", "get")?.permission, "products.read");
});

// ──────────────── العطبُ الأوّل: ترتيبُ الأنماط ────────────────

test("🔴 أوّلُ مطابقةٍ تفوز — والأخصُّ مكتوبٌ قبل الأعمّ", () => {
  // وقع فعلاً: ترجيحٌ بـ«أطولِ نمطٍ يفوز» جعل دفعةَ المنتجات تقع تحت
  // `products.write` بدل `products.bulk_update` — **فتجاوزت حدَّ
  // الخمسمئة صنف صامتةً**، لأن النمطَ الأخصَّ أقصرُ نصّاً من الأعمّ.
  const r = ruleFor("/products/batch", "POST");
  assert.equal(r?.permission, "products.bulk_update");
  assert.deepEqual(r?.countFields, ["create.length", "update.length", "delete.length"]);

  // والترتيبُ نفسُه في المصفوفة جزءٌ من التعريف لا تجميل.
  const iBatch = ADMIN_ROUTE_RULES.findIndex((x) => x.pattern.source.includes("batch"));
  const iWrite = ADMIN_ROUTE_RULES.findIndex((x) => x.permission === "products.write");
  assert.ok(iBatch < iWrite, "قاعدةُ الدفعة يجب أن تسبق قاعدةَ الكتابة");
});

// ──────────────── العطبُ الثاني: سقفُ المال ────────────────

test("🔴 الاستردادُ يعلن حقلَ المبلغ — وبغيره استردادٌ بلا سقف", () => {
  const r = ruleFor("/payments/pay_1/refund", "POST");
  assert.equal(r?.permission, "payments.refund");
  assert.equal(r?.amountField, "amount", "غيابُه يعني تجاوزَ السقفِ صامتاً");
});

test("🔴 readField: المبلغُ مبلغٌ نصّاً كان أو رقماً", () => {
  // مبالغُ Medusa تعبر بـ`BigNumberInput` **وهو يقبل النصّ**. وكان
  // الشرطُ `typeof === "number"` وحدَه، فجسمٌ فيه `{"amount":"99999900"}`
  // يُعيد undefined فيتخطّى `can()` فحصَ السقف كلَّه — ويمرّ استردادٌ
  // فوق سقف الدور صامتاً.
  assert.equal(readField({ amount: 99999900 }, "amount"), 99999900);
  assert.equal(readField({ amount: "99999900" }, "amount"), 99999900);
  assert.equal(readField({ amount: "  12900  " }, "amount"), 12900);
});

test("readField: ما ليس مبلغاً لا يمرّ — والهللةُ صحيحةٌ بلا كسرٍ ولا إشارة", () => {
  assert.equal(readField({ amount: "12.5" }, "amount"), undefined, "كسرٌ يُردّ ولا يُقرَّب صامتاً");
  assert.equal(readField({ amount: "-100" }, "amount"), undefined);
  assert.equal(readField({ amount: "1e5" }, "amount"), undefined);
  assert.equal(readField({ amount: "" }, "amount"), undefined);
  assert.equal(readField({ amount: NaN }, "amount"), undefined);
  assert.equal(readField({ amount: Infinity }, "amount"), undefined);
  assert.equal(readField({}, "amount"), undefined);
  assert.equal(readField(null, "amount"), undefined);
  assert.equal(readField({ amount: 1 }, undefined), undefined);
});

test("readField: يمشي في المسار المنقوط ويقرأ طولَ المصفوفة", () => {
  assert.equal(readField({ update: [1, 2, 3] }, "update.length"), 3);
  assert.equal(readField({ a: { b: { c: 7 } } }, "a.b.c"), 7);
  assert.equal(readField({ a: null }, "a.b.c"), undefined, "لا ينفجر على غيابٍ في المنتصف");
});

// ──────────────── العطبُ الثالث: عدُّ الدفعة ────────────────

test("🔴 readCount: الدفعةُ تُقاس بأثقلِ أذرعها لا بأوّلها", () => {
  // دفعةٌ فيها `create` بخمسة آلافٍ و`update` بواحدٍ **دفعةُ خمسةِ آلاف**.
  // وكان الحقلُ واحداً (`update.length`)، فدفعةُ إنشاءٍ بلا تعديلٍ
  // تمرّ بلا عدٍّ — والسقفُ لا يُفحص أصلاً.
  const fields = ["create.length", "update.length", "delete.length"];

  // ⚠️ والحالةُ الفاصلةُ هي التي يكون فيها **الأوّلُ أصغرَ**: الحلقةُ
  // تمشي على `fields` لا على مفاتيح الجسم، فوضعُ الأكبر في أوّل حقلٍ
  // يجعل «أوّلُ ما وُجد» و«أكبرُ ما وُجد» يتّفقان — ولا يقيس شيئاً.
  // (كُتبت هكذا أوّلاً، وكشفه نقضُ الاختبار.)
  assert.equal(readCount({ create: [1], update: new Array(5000) }, fields), 5000);
  assert.equal(readCount({ create: new Array(5000), update: [1] }, fields), 5000);
  assert.equal(readCount({ delete: new Array(7) }, fields), 7, "ذراعٌ واحدةٌ موجودة");
});

test("readCount: لا حقولَ ⇒ undefined — «لم يُقرأ شيء» لا «صفر»", () => {
  // والفرقُ جوهريّ: الوسيطُ يقرّر ماذا يفعل بـundefined، وصفرٌ يعني
  // دفعةً فارغةً مسموحة.
  assert.equal(readCount({ create: [1] }, undefined), undefined);
  assert.equal(readCount({ create: [1] }, []), undefined);
  assert.equal(readCount({}, ["create.length"]), undefined);
});

// ──────────────── قائمةُ الإعفاء ────────────────

test("الإعفاءُ قائمةٌ مغلقةٌ ومُبرَّرة", () => {
  assert.equal(isExempt("/auth"), true);
  assert.equal(isExempt("/auth/session"), true);
  assert.equal(isExempt("/invites/accept"), true);
  assert.equal(isExempt("/users/me"), true);
  assert.equal(isExempt("/uploads"), true);
});

test("🔴 الإعفاءُ لا يتسرّب إلى ما يجاوره في الاسم", () => {
  // `^\/users\/me$` مثبَّتٌ بالطرفين عمداً: لولا ذلك لأعفى
  // `/users/me/permissions` أو `/users/mendel` — وهي مساراتٌ أخرى.
  assert.equal(isExempt("/users/me/permissions"), false);
  assert.equal(isExempt("/users"), false);
  assert.equal(isExempt("/uploads/secret"), false);
  assert.equal(isExempt("/authorize"), false, "«authorize» ليست «auth/»");
  assert.equal(isExempt("/products"), false);
});

test("كلُّ إعفاءٍ مثبَّتٌ في أوّل المسار — لا يطابق في وسطه", () => {
  // إعفاءٌ بلا `^` يُطابق `/orders/auth` ويفتح باباً لا يعلمه أحد.
  for (const p of EXEMPT) {
    assert.ok(p.source.startsWith("^"), `نمطٌ غيرُ مثبَّت: ${p.source}`);
  }
});

// ──────────────── سلامةُ المصفوفة نفسِها ────────────────

test("كلُّ قاعدةٍ تحمل صلاحيةً وطريقةً واحدةً على الأقلّ", () => {
  for (const r of ADMIN_ROUTE_RULES) {
    assert.ok(r.permission.length > 0, `قاعدةٌ بلا صلاحية: ${r.pattern.source}`);
    assert.ok(r.methods.length > 0, `قاعدةٌ بلا طريقة: ${r.pattern.source}`);
    assert.ok(r.pattern.source.startsWith("^"), `نمطٌ غيرُ مثبَّت: ${r.pattern.source}`);
  }
});

test("الأنماطُ بلا علامة g — فـlastIndex يجعل المطابقةَ تتناوب", () => {
  // نمطٌ بـ`g` يحفظ موضعَه بين النداءات، فيطابق مرّةً ولا يطابق التالية:
  // طلبٌ يُرفض وطلبٌ يمرّ للمسار نفسِه، بلا سببٍ ظاهر.
  for (const r of ADMIN_ROUTE_RULES) {
    assert.equal(r.pattern.global, false, `نمطٌ عامّ: ${r.pattern.source}`);
  }
  for (const p of EXEMPT) assert.equal(p.global, false, `نمطٌ عامّ: ${p.source}`);
});
