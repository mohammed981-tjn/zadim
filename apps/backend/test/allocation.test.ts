/**
 * اختباراتُ إسناد الشحنات — `modules/warehouse/allocation.ts`.
 *
 * ── أخطرُ ما فيها ────────────────────────────────────────────────
 *
 * **استثناءان لا واحد، ولا يُدمجان**: `is_fulfilment_enabled = false`
 * إذنٌ مسحوبٌ مؤقّتاً يُعاد بنقرة، و`is_returns_location = true` صفةُ
 * مكانٍ يقف فيه الراجعُ حتى يُفحص. فلو حُمل الثاني على الأوّل لكان
 * إعادةُ الإذن صباحاً — وهي نقرةٌ روتينية — **بيعاً لبضاعةٍ لم يرَها
 * أحد**.
 *
 * والقاعدةُ تمنع اجتماعَهما، ولا يُتّكَل على ذلك هنا: هذه دالّةٌ خالصةٌ
 * تأخذ الملفّاتِ معطىً ولا ترى القيد.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankLocations, planAllocation } from "../src/modules/warehouse/allocation.ts";

// ──────────────── ترشيحُ المواقع ────────────────

test("🔴 موقعُ المرتجعات لا يُشحن منه — ولو كان الإذنُ قائماً", () => {
  const out = rankLocations(
    ["loc_ok", "loc_returns"],
    [
      { location_id: "loc_ok", is_fulfilment_enabled: true },
      { location_id: "loc_returns", is_fulfilment_enabled: true, is_returns_location: true },
    ]
  );
  assert.deepEqual(out, ["loc_ok"], "صفةُ المكان لا يرفعها إذنٌ");
});

test("إذنٌ مسحوبٌ يُخرج الموقعَ — ويُعاد بنقرة", () => {
  const profiles = [{ location_id: "loc_a", is_fulfilment_enabled: false }];
  assert.deepEqual(rankLocations(["loc_a", "loc_b"], profiles), ["loc_b"]);
  assert.deepEqual(
    rankLocations(["loc_a", "loc_b"], [{ location_id: "loc_a", is_fulfilment_enabled: true }]),
    ["loc_a", "loc_b"]
  );
});

test("موقعٌ بلا ملفٍّ مؤهَّلٌ بأولوية صفر — الملفُّ يُرتّب ولا يأذن", () => {
  assert.deepEqual(rankLocations(["loc_a"], []), ["loc_a"]);
});

test("🔴 مطابقةُ مدينة الوجهة تسبق الأولوية", () => {
  // أقربُ مستودعٍ للعميل أوّلاً ولو كانت أولويّتُه أدنى.
  const out = rankLocations(
    ["loc_far", "loc_near"],
    [
      { location_id: "loc_far", priority: 99, city: "جدة" },
      { location_id: "loc_near", priority: 1, city: "الرياض" },
    ],
    "  الرياض "
  );
  assert.deepEqual(out, ["loc_near", "loc_far"], "والمسافاتُ والحالةُ لا تكسر المطابقة");
});

test("بلا مدينةِ وجهةٍ: الأولويةُ الأعلى أوّلاً", () => {
  const out = rankLocations(
    ["loc_low", "loc_high"],
    [
      { location_id: "loc_low", priority: 1 },
      { location_id: "loc_high", priority: 9 },
    ]
  );
  assert.deepEqual(out, ["loc_high", "loc_low"]);
});

test("🔴 التعادلُ يُحسم بالمعرّف — لا ترتيبَ عشوائيّ", () => {
  // خطّتان مختلفتان لنفس الطلب في نداءين تجعلان التشخيصَ مستحيلاً.
  const ids = ["loc_c", "loc_a", "loc_b"];
  assert.deepEqual(rankLocations(ids, []), ["loc_a", "loc_b", "loc_c"]);
  assert.deepEqual(rankLocations([...ids].reverse(), []), ["loc_a", "loc_b", "loc_c"]);
});

// ──────────────── خطّةُ الإسناد ────────────────

const avail = (rows: [string, string, number][]) =>
  rows.map(([location_id, inventory_item_id, available]) => ({
    location_id,
    inventory_item_id,
    available,
  }));

test("🔴 شحنةٌ واحدةٌ تكفي ⇒ لا تُقسَّم", () => {
  // التقسيمُ يكلّف شحنتين ويُربك العميل، فالمفضَّلُ موقعٌ يغطّي الكلّ.
  const plan = planAllocation({
    lines: [{ inventory_item_id: "i1", quantity: 2 }, { inventory_item_id: "i2", quantity: 1 }],
    availability: avail([
      ["loc_a", "i1", 1],
      ["loc_b", "i1", 5],
      ["loc_b", "i2", 5],
    ]),
  });
  assert.equal(plan.split_count, 1);
  assert.equal(plan.shipments[0].location_id, "loc_b");
  assert.equal(plan.fully_allocatable, true);
  assert.deepEqual(plan.unfulfilled, []);
});

test("🔴 شحنةٌ واحدةٌ من موقعٍ أدنى ترتيباً تسبق تقسيماً من الأعلى", () => {
  // كُتب هذا الاختبارُ أوّلاً يتوقّع تقسيماً، فسقط — **والتوقُّعُ كان
  // الخطأ لا الكود**: `loc_b` وحدَه يغطّي الطلبَ كلَّه، والبحثُ عن شحنةٍ
  // واحدةٍ يسبق التقسيمَ مهما كان الترتيب. وهو الصواب: شحنتان تكلّفان
  // ضِعفاً وتُربكان العميل.
  const plan = planAllocation({
    lines: [{ inventory_item_id: "i1", quantity: 3 }],
    availability: avail([["loc_a", "i1", 2], ["loc_b", "i1", 5]]),
    profiles: [
      { location_id: "loc_a", priority: 9 },
      { location_id: "loc_b", priority: 1 },
    ],
  });
  assert.equal(plan.split_count, 1);
  assert.equal(plan.shipments[0].location_id, "loc_b");
});

test("لا موقعَ يغطّي الكلّ ⇒ يُقسَّم من الأعلى ترتيباً", () => {
  const plan = planAllocation({
    lines: [{ inventory_item_id: "i1", quantity: 3 }],
    availability: avail([["loc_a", "i1", 2], ["loc_b", "i1", 2]]),
    profiles: [
      { location_id: "loc_a", priority: 9 },
      { location_id: "loc_b", priority: 1 },
    ],
  });
  assert.equal(plan.split_count, 2);
  assert.equal(plan.shipments[0].location_id, "loc_a", "الأعلى ترتيباً يأخذ أكبرَ ما عنده");
  assert.deepEqual(plan.shipments[0].lines, [{ inventory_item_id: "i1", quantity: 2 }]);
  assert.deepEqual(plan.shipments[1].lines, [{ inventory_item_id: "i1", quantity: 1 }]);
  assert.equal(plan.fully_allocatable, true);
});

test("نقصٌ حقيقيٌّ يُبلَّغ بمقداره — لا يُخفى", () => {
  const plan = planAllocation({
    lines: [{ inventory_item_id: "i1", quantity: 10 }],
    availability: avail([["loc_a", "i1", 4]]),
  });
  assert.deepEqual(plan.unfulfilled, [{ inventory_item_id: "i1", quantity: 6 }]);
  assert.equal(plan.fully_allocatable, false);
});

test("🔴 عدّادٌ فاسدٌ (متاحٌ سالب) لا يُنتج شحنةً وهميّة", () => {
  // ⚠️ ويحرسه **حارسان**، ونُقض كلٌّ منهما على حدة: قصُّ السالب إلى صفرٍ
  // عند القراءة، وشرطُ `got > 0` عند الأخذ. ونزعُ القصِّ وحدَه لا يغيّر
  // النتيجةَ — الشرطُ يمسكها — فلا يُقال إن هذا الاختبارَ يحرس القصّ.
  // ما يحرسه هو **النتيجة**: لا شحنةَ ولا سطرَ بكمّيةٍ سالبة.
  const plan = planAllocation({
    lines: [{ inventory_item_id: "i1", quantity: 1 }],
    availability: avail([["loc_a", "i1", -5]]),
  });
  assert.deepEqual(plan.shipments, []);
  assert.deepEqual(plan.unfulfilled, [{ inventory_item_id: "i1", quantity: 1 }]);
  assert.equal(plan.fully_allocatable, false);
});

test("سطرٌ بكمّيةٍ صفرٍ أو سالبةٍ يُسقَط", () => {
  const plan = planAllocation({
    lines: [
      { inventory_item_id: "i1", quantity: 0 },
      { inventory_item_id: "i2", quantity: 2 },
    ],
    availability: avail([["loc_a", "i2", 5]]),
  });
  assert.deepEqual(plan.shipments[0].lines, [{ inventory_item_id: "i2", quantity: 2 }]);
});

test("لا سطورَ مطلوبةً ⇒ ليست خطّةً قابلةً للتنفيذ", () => {
  // `fully_allocatable: true` لطلبٍ فارغٍ يخدع من يقرؤه، فهو `false`
  // صراحةً (`need.length > 0`).
  //
  // ⚠️ وحافّةٌ تُسجَّل كما هي: الطلبُ الفارغ يُنتج **شحنةً بلا سطور**،
  // لأن `every` على مصفوفةٍ فارغةٍ صحيحٌ فيفوز أوّلُ موقع. ولا يقع في
  // الإنتاج (كلُّ طلبٍ له سطور)، ومن يقرأ الخطّةَ يحكم بـ
  // `fully_allocatable` لا بعدد الشحنات. ولو صار مساراً يستدعيها بطلبٍ
  // فارغٍ يوماً، فهذا الاختبارُ هو الذي يُظهر السلوك.
  const plan = planAllocation({ lines: [], availability: avail([["loc_a", "i1", 5]]) });
  assert.equal(plan.fully_allocatable, false, "وهو الحكمُ الذي يُقرأ");
  assert.deepEqual(plan.shipments[0].lines, [], "والشحنةُ بلا سطورٍ — حافّةٌ مسجَّلة");
});

test("🔴 موقعُ المرتجعات مستبعَدٌ من الخطّة لا من الترشيح وحدَه", () => {
  const plan = planAllocation({
    lines: [{ inventory_item_id: "i1", quantity: 1 }],
    availability: avail([["loc_returns", "i1", 100]]),
    profiles: [{ location_id: "loc_returns", is_returns_location: true }],
  });
  assert.deepEqual(plan.shipments, [], "بضاعةٌ لم يرَها أحدٌ لا تُباع");
  assert.equal(plan.fully_allocatable, false);
});
