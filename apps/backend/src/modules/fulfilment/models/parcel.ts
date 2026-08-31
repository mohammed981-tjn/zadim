import { model } from "@medusajs/framework/utils";

/**
 * الطردُ المغلَّف.
 *
 * والوزنُ إلزاميّ: الناقلُ يسعّر به، وطردٌ بلا وزنٍ يُرفض عند إصدار
 * البوليصة — **بعد أن يكون قد غُلّف وأُغلق**.
 */
export const Parcel = model.define("zadim_parcel", {
  id: model.id({ prefix: "prcl" }).primaryKey(),

  fulfillment_id: model.text().nullable(),
  pick_list_id: model.text().nullable(),

  barcode: model.text().unique(),
  weight_grams: model.number(),
  length_mm: model.number().nullable(),
  width_mm: model.number().nullable(),
  height_mm: model.number().nullable(),

  packed_by: model.text().nullable(),
});

export default Parcel;
