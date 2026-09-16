/**
 * اختباراتُ تنبيه النفاد — `modules/warehouse/alerts.ts`.
 *
 * ── وأدقُّ ما فيها قاعدتان ───────────────────────────────────────
 *
 * **المتاحُ لا الموجود**: بضاعةٌ كلُّها محجوزةٌ **نفدت وإن امتلأ الرفّ**
 * — ومن يقيس بالموجود يرى رفّاً عامراً ويبيع ما لا يملك.
 *
 * **وعند تساوي الخصوصية يُؤخذ الأدنى حدّاً**: قاعدتان بنفس النطاق خطأٌ
 * إداريّ، والأحوطُ حينها أن يُنبَّه أبكر لا أن يُسكت.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveThreshold,
  findBreaches,
  type AlertRuleInput,
  type LevelRow,
} from "../src/modules/warehouse/alerts.ts";

const rule = (o: Partial<AlertRuleInput> & { id: string; scope: AlertRuleInput["scope"] }): AlertRuleInput => ({
  threshold_quantity: 5,
  ...o,
});

const lvl = (o: Partial<LevelRow> = {}): LevelRow => ({
  inventory_item_id: "itm",
  location_id: "loc",
  stocked_quantity: 100,
  reserved_quantity: 0,
  ...o,
});

// ──────────────── أيُّ قاعدةٍ تنطبق ────────────────

test("🔴 الأخصُّ يفوز: صنفٌ+موقع ⇒ صنف ⇒ موقع ⇒ عامّ", () => {
  const all = [
    rule({ id: "g", scope: "global", threshold_quantity: 1 }),
    rule({ id: "l", scope: "location", location_id: "loc", threshold_quantity: 2 }),
    rule({ id: "i", scope: "item", inventory_item_id: "itm", threshold_quantity: 3 }),
    rule({ id: "il", scope: "item_location", inventory_item_id: "itm", location_id: "loc", threshold_quantity: 4 }),
  ];
  assert.equal(resolveThreshold(all, "itm", "loc")?.id, "il");
  assert.equal(resolveThreshold(all.slice(0, 3), "itm", "loc")?.id, "i");
  assert.equal(resolveThreshold(all.slice(0, 2), "itm", "loc")?.id, "l");
  assert.equal(resolveThreshold(all.slice(0, 1), "itm", "loc")?.id, "g");
});

test("قاعدةُ صنفٍ آخرَ أو موقعٍ آخرَ لا تنطبق", () => {
  const rules = [
    rule({ id: "i2", scope: "item", inventory_item_id: "غيره" }),
    rule({ id: "l2", scope: "location", location_id: "غيره" }),
  ];
  assert.equal(resolveThreshold(rules, "itm", "loc"), null);
});

test("قاعدةٌ مطفأةٌ لا تُحتسب — والغيابُ ليس إطفاءً", () => {
  assert.equal(resolveThreshold([rule({ id: "g", scope: "global", is_active: false })], "itm", "loc"), null);
  assert.equal(resolveThreshold([rule({ id: "g", scope: "global" })], "itm", "loc")?.id, "g");
  assert.equal(resolveThreshold([rule({ id: "g", scope: "global", is_active: true })], "itm", "loc")?.id, "g");
});

test("🔴 عند تساوي الخصوصية: الأدنى حدّاً — يُنبَّه أبكر لا يُسكت", () => {
  const rules = [
    rule({ id: "a", scope: "global", threshold_quantity: 20 }),
    rule({ id: "b", scope: "global", threshold_quantity: 5 }),
  ];
  assert.equal(resolveThreshold(rules, "itm", "loc")?.id, "b");
  assert.equal(resolveThreshold([...rules].reverse(), "itm", "loc")?.id, "b", "ولا يتأثّر بالترتيب");
});

test("وعند تساوي الحدّ أيضاً: المعرّفُ يحسم — لا عشوائية", () => {
  const rules = [
    rule({ id: "ب", scope: "global", threshold_quantity: 5 }),
    rule({ id: "أ", scope: "global", threshold_quantity: 5 }),
  ];
  assert.equal(resolveThreshold(rules, "itm", "loc")?.id, "أ");
});

test("لا قواعدَ ⇒ null — ولا حدَّ افتراضيّ مبرمَج", () => {
  assert.equal(resolveThreshold([], "itm", "loc"), null);
});

// ──────────────── الخروق ────────────────

test("🔴 المتاحُ لا الموجود — رفٌّ عامرٌ كلُّه محجوزٌ نفد", () => {
  const out = findBreaches([lvl({ stocked_quantity: 100, reserved_quantity: 100 })], [
    rule({ id: "g", scope: "global", threshold_quantity: 5 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].available, 0, "ومن يقيس بالموجود يبيع ما لا يملك");
});

test("الحدُّ شاملٌ: المساوي خرقٌ وما فوقه ليس", () => {
  const rules = [rule({ id: "g", scope: "global", threshold_quantity: 5 })];
  assert.equal(findBreaches([lvl({ stocked_quantity: 5 })], rules).length, 1, "يساوي الحدَّ ⇒ خرق");
  assert.equal(findBreaches([lvl({ stocked_quantity: 6 })], rules).length, 0);
});

test("مستوىً لا قاعدةَ له يُتجاوَز بصمت", () => {
  const out = findBreaches([lvl({ inventory_item_id: "itm" })], [
    rule({ id: "i", scope: "item", inventory_item_id: "غيره", threshold_quantity: 999 }),
  ]);
  assert.deepEqual(out, []);
});

test("🔴 الأشدُّ نقصاً أوّلاً — من يفتح التقرير يرى ما يحترق قبل ما يدخّن", () => {
  const rules = [rule({ id: "g", scope: "global", threshold_quantity: 10 })];
  const out = findBreaches(
    [
      lvl({ inventory_item_id: "a", stocked_quantity: 8 }),
      lvl({ inventory_item_id: "b", stocked_quantity: 1 }),
      lvl({ inventory_item_id: "c", stocked_quantity: 5 }),
    ],
    rules
  );
  assert.deepEqual(out.map((b) => b.available), [1, 5, 8]);
});

test("الخرقُ يحمل القاعدةَ التي أطلقته — فيُعرف من أين جاء الرقم", () => {
  const out = findBreaches([lvl({ stocked_quantity: 1 })], [
    rule({ id: "il", scope: "item_location", inventory_item_id: "itm", location_id: "loc", threshold_quantity: 3 }),
  ]);
  assert.equal(out[0].rule_id, "il");
  assert.equal(out[0].scope, "item_location");
  assert.equal(out[0].threshold, 3);
});

test("متاحٌ سالبٌ يُبلَّغ كما هو — لا يُخفى بقصِّه إلى صفر", () => {
  // عدّادٌ يقول «‎-٣» عطبٌ يجب أن يُرى، لا أن يُجمَّل.
  const out = findBreaches([lvl({ stocked_quantity: 2, reserved_quantity: 5 })], [
    rule({ id: "g", scope: "global", threshold_quantity: 0 }),
  ]);
  assert.equal(out[0].available, -3);
});
