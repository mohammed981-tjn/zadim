/**
 * اختباراتُ سلسلة الفواتير — `modules/zatca/chain.ts`.
 *
 * ── لماذا هذه أعلى ما في النظام مخاطرةً ──────────────────────────
 *
 * لأنها **الجزءُ الذي لا يُضاف بأثرٍ رجعيّ**: كلُّ فاتورةٍ تُختم لحظةَ
 * إصدارها أو لا تُختم أبداً. فعطبٌ هنا لا يُكتشف إلا بعد آلافِ الطلبات،
 * وعلاجُه عندئذٍ فجوةٌ تُفسَّر للهيئة أو إعادةُ بناء طبقة المال كلِّها.
 *
 * وأخطرُ ما فيه أن الفاحصَ نفسَه كان معطوباً: سطران يُعفيان مطلعَ
 * السلسلة من كلّ شرط، فسلسلةٌ حُذفت فواتيرُها الأولى تمرّ `ok: true`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  genesisHash,
  canonicalize,
  invoiceHash,
  verifyChain,
  FIRST_SEQUENCE,
  type ChainRow,
} from "../src/modules/zatca/chain.ts";

// ──────────────── الحمولةُ المعياريّة ────────────────

test("🔴 canonicalize: ترتيبُ المفاتيح لا يغيّر التجزئة", () => {
  // `JSON.stringify` يتبع ترتيبَ الإدخال، فكائنان بنفس المحتوى وترتيبٍ
  // مختلفٍ يعطيان تجزئتين — **فتنكسر السلسلةُ عند أوّل إعادةِ حساب**
  // لسببٍ لا يظهر في البيانات.
  const a = { total: 100, buyer: "س", lines: [{ qty: 1, sku: "أ" }] };
  const b = { lines: [{ sku: "أ", qty: 1 }], buyer: "س", total: 100 };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(invoiceHash("x", a), invoiceHash("x", b));
});

test("canonicalize: ترتيبُ عناصر المصفوفة **يُحفظ** — وهو معنىً لا شكل", () => {
  // سطرُ فاتورةٍ أوّلُ غيرُ سطرٍ ثانٍ، فالمصفوفةُ لا تُفرز.
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test("canonicalize: يعمّق الترتيبَ في الكائنات المتداخلة", () => {
  assert.equal(
    canonicalize({ a: { y: 1, x: 2 } }),
    canonicalize({ a: { x: 2, y: 1 } })
  );
});

test("canonicalize: القيمُ الأوّلية والفراغُ تمرّ كما هي", () => {
  assert.equal(canonicalize(null), "null");
  assert.equal(canonicalize({}), "{}");
  assert.equal(canonicalize({ a: null }), '{"a":null}');
});

// ──────────────── التجزئة ────────────────

test("genesisHash: تُحسب ولا تُكتب رقماً — وثابتةٌ بين النداءات", () => {
  // ثابتٌ منسوخٌ من ذاكرةِ أحدٍ يُخطئ بايتاً فتُرفض السلسلةُ كلُّها
  // ولا يُعرف السبب.
  const g = genesisHash();
  assert.equal(g, genesisHash());
  // تجزئةُ "0" ستّ عشريّاً ثم Base64 ⇒ ٦٤ حرفاً هكسيّاً مُرمَّزاً.
  assert.equal(Buffer.from(g, "base64").toString("utf8").length, 64);
  assert.match(Buffer.from(g, "base64").toString("utf8"), /^[0-9a-f]{64}$/);
});

test("invoiceHash: يتغيّر بتغيّر الحمولة وبتغيّر ما قبلها", () => {
  const p = { total: 100 };
  assert.notEqual(invoiceHash("a", p), invoiceHash("b", p), "السابقةُ تدخل التجزئة");
  assert.notEqual(invoiceHash("a", p), invoiceHash("a", { total: 101 }), "الحمولةُ تدخل");
  assert.equal(invoiceHash("a", p), invoiceHash("a", { total: 100 }), "وثابتةٌ لنفس المدخل");
});

// ──────────────── بناءُ سلسلةٍ صحيحة ────────────────

/** يبني سلسلةً متّصلةً من حمولاتٍ متتابعة. */
function chainOf(payloads: unknown[]): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = genesisHash();
  payloads.forEach((payload, i) => {
    const invoice_hash = invoiceHash(prev, payload);
    rows.push({ sequence: FIRST_SEQUENCE + i, previous_hash: prev, invoice_hash, payload });
    prev = invoice_hash;
  });
  return rows;
}

test("سلسلةٌ متّصلةٌ تمرّ — والفارغةُ كذلك", () => {
  assert.deepEqual(verifyChain(chainOf([{ a: 1 }, { a: 2 }, { a: 3 }])), { ok: true });
  assert.deepEqual(verifyChain([]), { ok: true }, "لا فواتيرَ بعد ⇒ لا انكسار");
});

test("الفحصُ لا يعتمد على ترتيب الإدخال — يُفرز أوّلاً", () => {
  const rows = chainOf([{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.deepEqual(verifyChain([...rows].reverse()), { ok: true });
});

// ──────────────── الأعطابُ التي يجب أن تُكشف ────────────────

test("🔴 السلسلةُ لا تبدأ من أوّلها — أخطرُ ما كان يفوت الفاحص", () => {
  // كان مطلعُ السلسلة مُعفىً من كلّ شرط، فسلسلةٌ حُذفت فواتيرُها الأولى
  // — أو بدأت من ٥٠٠ — تمرّ `ok: true`. والفجوةُ في المطلع لا يكشفها
  // إلا ربطُ أوّلِ صفٍّ برقم البداية وتجزئة التكوين.
  const rows = chainOf([{ a: 1 }, { a: 2 }, { a: 3 }]).slice(1);
  const r = verifyChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.broken_at, 2);
  assert.match(r.reason!, /لا تبدأ من أوّلها/, "والحدُّ يُسمّى: المفقودُ قبل ما تراه");
});

test("🔴 الفاتورةُ الأولى لا تتّصل بتجزئة التكوين", () => {
  const rows = chainOf([{ a: 1 }, { a: 2 }]);
  rows[0] = { ...rows[0], previous_hash: "تجزئةٌ مخترَعة" };
  const r = verifyChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.broken_at, FIRST_SEQUENCE);
  assert.match(r.reason!, /تجزئة التكوين/);
});

test("فجوةٌ في وسط التسلسل", () => {
  const rows = chainOf([{ a: 1 }, { a: 2 }, { a: 3 }]);
  const r = verifyChain([rows[0], rows[2]]);
  assert.equal(r.ok, false);
  assert.equal(r.broken_at, 3);
  assert.equal(r.reason, "فجوةٌ في التسلسل");
});

test("رقمٌ مكرَّرٌ يُكشف — تسلسلٌ لا يتقدّم ليس تسلسلاً", () => {
  const rows = chainOf([{ a: 1 }, { a: 2 }]);
  const r = verifyChain([rows[0], { ...rows[1], sequence: FIRST_SEQUENCE }]);
  assert.equal(r.ok, false);
});

test("🔴 حمولةٌ عُدّلت بعد الختم ⇒ التجزئةُ لا تطابق", () => {
  // هذا هو الثابتُ كلُّه: ما خُتم لا يُعدَّل. ولو مرّ هذا لما كانت
  // للسلسلة قيمة.
  const rows = chainOf([{ total: 100 }, { total: 200 }]);
  rows[1] = { ...rows[1], payload: { total: 999 } };
  const r = verifyChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.broken_at, 2);
  assert.equal(r.reason, "التجزئةُ لا تطابق الحمولة");
});

test("تجزئةُ السابقة لا تطابق ⇒ يُكشف قبل فحص الحمولة", () => {
  const rows = chainOf([{ a: 1 }, { a: 2 }]);
  rows[1] = { ...rows[1], previous_hash: genesisHash() };
  const r = verifyChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "تجزئةُ السابقة لا تطابق");
});

test("🔴 الفحصُ يمرّ على السلسلة كلِّها لا على آخرِ صفّ", () => {
  // سلسلةٌ تنكسر في وسطها لا يكشفها فحصُ آخرِ صفٍّ وحدَه.
  const rows = chainOf([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }]);
  rows[2] = { ...rows[2], payload: { a: "مبدَّل" } };
  const r = verifyChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.broken_at, 3, "ويُسمّى موضعُ الانكسار لا مجرّدُ «مكسورة»");
});

test("FIRST_SEQUENCE تعريفٌ مشترك — لا رقمٌ مكتوبٌ في موضعين", () => {
  // `service.ts` يبدأ منه عند الإصدار وهذا الملفُّ يفحص به. ورقمان
  // في موضعين يفترقان يوماً، فيُصدر الخادمُ سلسلةً يرفضها فاحصُها.
  assert.equal(FIRST_SEQUENCE, 1);
  assert.equal(verifyChain([{ ...chainOf([{ a: 1 }])[0], sequence: 0 }]).ok, false);
});
