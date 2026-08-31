import { model } from "@medusajs/framework/utils";

/**
 * قائمةُ اللقط — الورقةُ التي يمشي بها الملقِّط في المستودع.
 *
 * ولا تسكن `fulfillment` عند Medusa لأنها ليست فيه: Medusa يعرف
 * **الشحنة**، ولا يعرف من يلقطها ولا بأيّ ترتيبٍ يمشي ولا ماذا مسح.
 */
export const PickList = model.define("zadim_pick_list", {
  id: model.id({ prefix: "pick" }).primaryKey(),

  fulfillment_id: model.text().nullable(),
  order_id: model.text().nullable(),
  location_id: model.text(),

  state: model
    .enum(["pending", "picking", "picked", "blocked", "cancelled"])
    .default("pending"),

  assigned_to: model.text().nullable(),
  /** سببُ التوقّف حين يُمسح باركودٌ خاطئ — يُقرأ في الشاشة فوراً. */
  blocked_reason: model.text().nullable(),
}).indexes([
  { on: ["state"] },
  { on: ["fulfillment_id"] },
]);

export default PickList;
