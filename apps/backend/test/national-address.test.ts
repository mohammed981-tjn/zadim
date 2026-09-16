/**
 * اختباراتُ العنوان الوطنيّ — `modules/checkout/national-address.ts`.
 *
 * ── لماذا هذه الوحدةُ بالذات ──────────────────────────────────────
 *
 * لأنها **الحكمُ قبل إنشاء الطلب**، وفحصُ الواجهة لا يحرسها: مسارُ
 * السلّة عامٌّ من Medusa، ومن ينادِيه مباشرةً يكتب ما شاء.
 *
 * وخطؤها يقع في اتجاهين وكلاهما مُكلِف: قبولُ عنوانٍ ناقصٍ يعني طرداً
 * لا يصل وفاتورةَ ZATCA ناقصةَ حقول، ورفضُ عنوانٍ صحيحٍ كُتب بصيغةٍ
 * أخرى يعني **خسارةَ بيعٍ لا حماية**.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toAsciiDigits,
  normalizeSaudiMobile,
  validateNationalAddress,
  toMedusaAddress,
  readNationalAddress,
  type NationalAddressInput,
} from "../src/modules/checkout/national-address.ts";

// ──────────────── الأرقامُ الهندية والفارسية ────────────────

test("toAsciiDigits: العشرةُ الهندية والعشرةُ الفارسية كلُّها", () => {
  // العميلُ السعوديُّ يكتب بلوحةٍ عربية، ورفضُ «٠٥٠…» رفضُ الصيغة
  // التي يكتبها أكثرُ الناس.
  assert.equal(toAsciiDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(toAsciiDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789", "الفارسية أيضاً");
  assert.equal(toAsciiDigits("مبنى ١٢٣٤"), "مبنى 1234", "لا يمسّ الحروف");
  assert.equal(toAsciiDigits("0123"), "0123");
});

// ──────────────── الجوّال ────────────────

test("normalizeSaudiMobile: كلُّ صيغةٍ صحيحةٍ تُقبل وتُطبَّع", () => {
  for (const raw of [
    "0501234567",
    "501234567",
    "+966501234567",
    "00966501234567",
    "966501234567",
    "05 01 23 45 67",
    "050-123-4567",
    "٠٥٠١٢٣٤٥٦٧",
  ]) {
    assert.equal(normalizeSaudiMobile(raw), "0501234567", `الصيغة: ${raw}`);
  }
});

test("normalizeSaudiMobile: ما ليس جوّالاً سعوديّاً يُردّ", () => {
  assert.equal(normalizeSaudiMobile("0112345678"), null, "أرضيٌّ لا يبدأ بـ5");
  assert.equal(normalizeSaudiMobile("12345"), null, "أقصرُ من تسعة");
  assert.equal(normalizeSaudiMobile(""), null);
  assert.equal(normalizeSaudiMobile(null), null);
  assert.equal(normalizeSaudiMobile("لا أرقام"), null);
});

// ──────────────── التحقّق ────────────────

const good: NationalAddressInput = {
  first_name: "محمد",
  last_name: "العتيبي",
  phone: "0501234567",
  building_number: "1234",
  street: "طريق الملك فهد",
  district: "العليا",
  city: "الرياض",
  postal_code: "12211",
  additional_number: "5678",
};

test("عنوانٌ كاملٌ صحيحٌ يُقبل ويُطبَّع", () => {
  const r = validateNationalAddress(good);
  assert.equal(r.valid, true);
  if (!r.valid) return;
  assert.equal(r.value.phone, "0501234567");
  assert.equal(r.value.short_address, null);
  assert.equal(r.value.latitude, null);
});

test("🔴 تُعاد كلُّ الأخطاء لا أوّلُها", () => {
  // نموذجٌ يكشف خطأً واحداً في كل محاولةٍ يجعل العميلَ يُرسل خمسَ مرّات.
  const r = validateNationalAddress({});
  assert.equal(r.valid, false);
  if (r.valid) return;
  const fields = new Set(r.errors.map((e) => e.field));
  for (const f of [
    "first_name", "last_name", "phone", "building_number",
    "street", "district", "city", "postal_code", "additional_number",
  ]) {
    assert.ok(fields.has(f), `ينقص خطأُ ${f}`);
  }
  assert.ok(r.errors.length >= 9);
});

test("الأرقامُ الهندية مقبولةٌ في الحقول الرقمية", () => {
  const r = validateNationalAddress({ ...good, building_number: "١٢٣٤", postal_code: "١٢٢١١" });
  assert.equal(r.valid, true);
  if (r.valid) assert.equal(r.value.building_number, "1234");
});

test("طولُ الحقول الرقمية بالضبط: ٤ · ٥ · ٤", () => {
  for (const [key, bad] of [
    ["building_number", "123"],
    ["building_number", "12345"],
    ["postal_code", "1221"],
    ["additional_number", "567"],
  ] as const) {
    const r = validateNationalAddress({ ...good, [key]: bad });
    assert.equal(r.valid, false, `${key}=${bad} يجب أن يُرفض`);
    if (!r.valid) assert.equal(r.errors.find((e) => e.field === key)?.code, "FORMAT");
  }
});

test("الرسالةُ تقول ما وصل — لا «قيمةٌ غيرُ صالحة» وحدَها", () => {
  const r = validateNationalAddress({ ...good, postal_code: "123" });
  assert.equal(r.valid, false);
  if (!r.valid) assert.match(r.errors.find((e) => e.field === "postal_code")!.message_ar, /«123»/);
});

test("حقلٌ نصّيٌّ أطولُ من مئة حرفٍ يُردّ — لا يُحشى بصفحة", () => {
  const r = validateNationalAddress({ ...good, street: "ش".repeat(101) });
  assert.equal(r.valid, false);
  if (!r.valid) assert.equal(r.errors.find((e) => e.field === "street")?.code, "TOO_LONG");
  assert.equal(validateNationalAddress({ ...good, street: "ش".repeat(100) }).valid, true, "مئةٌ بالضبط تُقبل");
});

test("الفراغُ وحدَه ليس قيمة", () => {
  const r = validateNationalAddress({ ...good, city: "   " });
  assert.equal(r.valid, false);
  if (!r.valid) assert.equal(r.errors.find((e) => e.field === "city")?.code, "REQUIRED");
});

// ──────────────── الرمزُ المختصر ────────────────

test("الرمزُ المختصر اختياريٌّ — وحين يُكتب يُفحص ويُرفع", () => {
  assert.equal(validateNationalAddress({ ...good, short_address: "" }).valid, true);
  const ok = validateNationalAddress({ ...good, short_address: "rrrd2929" });
  assert.equal(ok.valid, true);
  if (ok.valid) assert.equal(ok.value.short_address, "RRRD2929", "يُرفع إلى الأحرف الكبيرة");
  const bad = validateNationalAddress({ ...good, short_address: "RRR2929" });
  assert.equal(bad.valid, false);
});

// ──────────────── الدبّوس ────────────────

test("🔴 إحداثيٌّ واحدٌ بلا الآخر نصفُ دبّوس — ولا يُرسم على خريطة", () => {
  const latOnly = validateNationalAddress({ ...good, latitude: 24.71 });
  assert.equal(latOnly.valid, false);
  if (!latOnly.valid) assert.equal(latOnly.errors.find((e) => e.field === "longitude")?.code, "REQUIRED");

  const lngOnly = validateNationalAddress({ ...good, longitude: 46.67 });
  assert.equal(lngOnly.valid, false);
  if (!lngOnly.valid) assert.equal(lngOnly.errors.find((e) => e.field === "latitude")?.code, "REQUIRED");

  const both = validateNationalAddress({ ...good, latitude: 24.71, longitude: 46.67 });
  assert.equal(both.valid, true);
  if (both.valid) assert.equal(both.value.latitude, 24.71);
});

test("إحداثيٌّ خارج المدى يُردّ — والحدُّ ٩٠ و١٨٠", () => {
  assert.equal(validateNationalAddress({ ...good, latitude: 91, longitude: 0 }).valid, false);
  assert.equal(validateNationalAddress({ ...good, latitude: 0, longitude: 181 }).valid, false);
  assert.equal(validateNationalAddress({ ...good, latitude: "س", longitude: 0 }).valid, false);
  assert.equal(validateNationalAddress({ ...good, latitude: 90, longitude: 180 }).valid, true, "الحدُّ نفسُه مقبول");
});

// ──────────────── التركيبُ والقراءة ────────────────

test("toMedusaAddress: الملصقُ يُركَّب بترتيبٍ يقرؤه المندوب", () => {
  const r = validateNationalAddress(good);
  assert.equal(r.valid, true);
  if (!r.valid) return;
  const m = toMedusaAddress(r.value);
  assert.equal(m.address_1, "1234 طريق الملك فهد");
  assert.equal(m.address_2, "العليا — 5678");
  assert.equal(m.country_code, "sa");
  assert.deepEqual(m.metadata.national_address, r.value, "والمهيكلُ يبقى هو المصدر");
});

test("🔴 readNationalAddress: يفحص الاكتمالَ لا الوجود", () => {
  const r = validateNationalAddress(good);
  assert.equal(r.valid, true);
  if (!r.valid) return;

  // عنوانٌ كامل ⇒ يُقرأ.
  assert.deepEqual(readNationalAddress(toMedusaAddress(r.value)), r.value);

  // وعنوانٌ كُتب قبل هذه الدفعة قد يحمل المفتاحَ بلا الحقول — وحضورُ
  // المفتاح لا يعني حضورَ ما فيه.
  assert.equal(readNationalAddress({ metadata: { national_address: {} } }), null);
  assert.equal(
    readNationalAddress({ metadata: { national_address: { ...good, postal_code: "12" } } }),
    null,
    "ناقصٌ جزئياً ⇒ null لا كائنٌ نصفُ صالح"
  );
  assert.equal(readNationalAddress({ metadata: {} }), null);
  assert.equal(readNationalAddress({}), null);
  assert.equal(readNationalAddress(null), null);
  assert.equal(readNationalAddress({ metadata: { national_address: "نصّ" } }), null);
});
