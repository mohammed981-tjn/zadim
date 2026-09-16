/**
 * اختباراتُ اللقط — `modules/fulfilment/picking.ts`.
 *
 * ── «الباركود يتحقّق ولا يثق» (بند ١٥) ──────────────────────────
 *
 * مسحُ صنفٍ خطأ **يوقف اللقط**. والسببُ أن الخطأ هنا لا يُكتشف بعده:
 * الطردُ يُغلق ويُشحن، فيصل العميلَ صنفٌ لم يطلبه — ويعود بشحنتين
 * وشكوى. والمخزونُ في الوقت نفسِه يقول إن الصنفَ الصحيح خرج، فيُباع
 * مرّةً ثانية وهو على الرفّ. **خطأٌ واحدٌ يُنتج ثلاثة**.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanBarcode,
  isComplete,
  shortfall,
  assignWalkOrder,
  type PickItem,
} from "../src/modules/fulfilment/picking.ts";

const item = (o: Partial<PickItem> = {}): PickItem => ({
  id: "li_1",
  title: "سمّاعة",
  barcode: "111",
  quantity: 2,
  picked_quantity: 0,
  ...o,
});

// ──────────────── المسح ────────────────

test("🔴 باركودٌ ليس في القائمة يُوقف اللقط", () => {
  const r = scanBarcode([item()], "999");
  assert.equal(r.accepted, false);
  if (r.accepted) return;
  assert.equal(r.code, "UNKNOWN_BARCODE");
  assert.equal(r.blocks, true, "الإيقافُ ثوانٍ، وتركُه شحنتان وعميلٌ ومخزونٌ يكذب");
  assert.match(r.reason_ar, /توقّف/);
});

test("🔴 والمكتملُ لا يوقف — زيادةٌ في نفس الصنف ليست خطأَ صنف", () => {
  const r = scanBarcode([item({ picked_quantity: 2 })], "111");
  assert.equal(r.accepted, false);
  if (r.accepted) return;
  assert.equal(r.code, "ALREADY_COMPLETE");
  assert.equal(r.blocks, false, "الملقّطُ مسح مرّتين — تُرفض الزيادةُ ولا تُوقف المسيرة");
});

test("مسحٌ فارغٌ عطلُ جهازٍ لا خطأُ صنف", () => {
  for (const code of ["", "   "]) {
    const r = scanBarcode([item()], code);
    assert.equal(r.accepted, false);
    if (r.accepted) continue;
    assert.equal(r.code, "EMPTY_BARCODE");
    assert.equal(r.blocks, false);
  }
});

test("مسحٌ صحيحٌ يزيد واحداً ويقول متى اكتمل", () => {
  const one = scanBarcode([item()], "111");
  assert.equal(one.accepted, true);
  if (!one.accepted) return;
  assert.equal(one.picked_quantity, 1);
  assert.equal(one.complete, false);

  const two = scanBarcode([item({ picked_quantity: 1 })], "111");
  assert.equal(two.accepted, true);
  if (!two.accepted) return;
  assert.equal(two.picked_quantity, 2);
  assert.equal(two.complete, true);
});

test("الباركودُ يُقصّ قبل المطابقة — والصنفُ بلا باركودٍ لا يُطابق فراغاً", () => {
  assert.equal(scanBarcode([item()], "  111 ").accepted, true);
  const r = scanBarcode([item({ barcode: null })], "111");
  assert.equal(r.accepted, false);
});

// ──────────────── الاكتمال والنقص ────────────────

test("🔴 قائمةٌ فارغةٌ ليست مكتملة", () => {
  // `every` على الفارغة صحيحٌ — فبلا شرط الطول ينتقل طردٌ بلا بنودٍ
  // إلى «مُلقَط».
  assert.equal(isComplete([]), false);
  assert.equal(isComplete([item({ picked_quantity: 2 })]), true);
  assert.equal(isComplete([item({ picked_quantity: 1 })]), false);
});

test("shortfall: الناقصُ بمقداره لا بوجوده", () => {
  const out = shortfall([
    item({ id: "a", picked_quantity: 2 }),
    item({ id: "b", title: "كيبل", quantity: 5, picked_quantity: 1 }),
  ]);
  assert.deepEqual(out, [{ id: "b", title: "كيبل", missing: 4 }]);
});

// ──────────────── ترتيبُ المشي ────────────────

const at = (id: string, bin: string | null) => item({ id, bin_location: bin });

test("🔴 الفرزُ عدديٌّ لا نصّيّ — وإلا مشى الملقّطُ الممرَّ مرّتين", () => {
  // نصّياً يأتي `A-10` قبل `A-2`.
  const out = assignWalkOrder([at("x", "A-10"), at("y", "A-2")]);
  assert.deepEqual(out.map((i) => i.bin_location), ["A-2", "A-10"]);
  assert.deepEqual(out.map((i) => i.walk_order), [1, 2], "والترقيمُ يبدأ من واحد");
});

test("الحرفُ يسبق الرقم في الوزن — الممرُّ A قبل B مهما كان رقمُه", () => {
  const out = assignWalkOrder([at("x", "B-1"), at("y", "A-99")]);
  assert.deepEqual(out.map((i) => i.bin_location), ["A-99", "B-1"]);
});

test("الفرزُ يعمّق: ممرٌّ ثم رفٌّ ثم صندوق", () => {
  const out = assignWalkOrder([at("x", "A-03-12"), at("y", "A-03-02"), at("z", "A-01-99")]);
  assert.deepEqual(out.map((i) => i.bin_location), ["A-01-99", "A-03-02", "A-03-12"]);
});

test("ما لا موقعَ له يُوضع في الآخر — يُبحث عنه بعد جمع الأكيدات", () => {
  const out = assignWalkOrder([at("x", null), at("y", "Z-99"), at("z", "")]);
  assert.equal(out[0].bin_location, "Z-99");
  assert.equal(out[out.length - 1].walk_order, 3);
});

test("🔴 التعادلُ يُحسم بالمعرّف — والقائمةُ قابلةٌ لإعادة الإنتاج", () => {
  // بلا هذا يختلف الترتيبُ بين تشغيلين على نفس البيانات.
  const rows = [at("c", "A-1"), at("a", "A-1"), at("b", "A-1")];
  assert.deepEqual(assignWalkOrder(rows).map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(assignWalkOrder([...rows].reverse()).map((i) => i.id), ["a", "b", "c"]);
});

test("assignWalkOrder لا يمسّ المصفوفةَ الأصلية", () => {
  const rows = [at("b", "A-2"), at("a", "A-1")];
  assignWalkOrder(rows);
  assert.deepEqual(rows.map((i) => i.id), ["b", "a"]);
  assert.equal(rows[0].walk_order, undefined);
});
