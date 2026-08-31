import { model } from "@medusajs/framework/utils";

/**
 * بندٌ في قائمة اللقط.
 *
 * ── `walk_order` ليس ترفاً ──────────────────────────────────────
 *
 * قائمةٌ مرتّبةٌ بترتيب الطلب تجعل الملقّطَ يعبر المستودعَ ذهاباً وإياباً
 * لكل بند. والترتيبُ بموقع الرفّ يجعلها **مسيرةً واحدة** — وهو أكبرُ
 * توفيرٍ منفردٍ في وقت اللقط.
 *
 * ── و`barcode` يُنسخ هنا لا يُقرأ من المنتج ────────────────────
 *
 * لأن الباركود قد يتغيّر على المنتج بعد طباعة القائمة، فيصير المسحُ
 * الصحيحُ خاطئاً بلا سبب. والقائمةُ تحمل ما كان وقتَ إنشائها.
 */
export const PickListItem = model.define("zadim_pick_list_item", {
  id: model.id({ prefix: "pcki" }).primaryKey(),

  pick_list_id: model.text(),
  inventory_item_id: model.text().nullable(),
  variant_id: model.text().nullable(),

  title: model.text(),
  sku: model.text().nullable(),
  barcode: model.text().nullable(),

  quantity: model.number(),
  picked_quantity: model.number().default(0),

  /** موقعُ الرفّ كما يُقرأ على اللافتة: `A-03-12`. */
  bin_location: model.text().nullable(),
  walk_order: model.number().default(0),
}).indexes([
  { on: ["pick_list_id"] },
  { on: ["barcode"] },
]);

export default PickListItem;
