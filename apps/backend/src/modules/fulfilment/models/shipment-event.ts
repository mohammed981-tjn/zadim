import { model } from "@medusajs/framework/utils";

/**
 * حدثُ تتبّعٍ من الناقل (بند ١٨) — **يُلحَق ولا يُعدَّل**.
 *
 * والعميلُ يقرأ هذه السطور. فحدثٌ يُعاد كتابتُه يعني تاريخَ شحنةٍ
 * يتغيّر بعد أن رآه صاحبُه — وذاك أسوأُ من ألّا نعرضه.
 *
 * و`raw` يحفظ ما أرسله الناقلُ كما هو: حين يختلف تفسيرُنا عن تفسيره
 * تكون المادّةُ موجودةً للمراجعة، لا ملخَّصُنا وحدَه.
 */
export const ShipmentEvent = model.define("zadim_shipment_event", {
  id: model.id({ prefix: "shev" }).primaryKey(),

  fulfillment_id: model.text().nullable(),
  tracking_number: model.text().nullable(),
  carrier_id: model.text().nullable(),

  code: model.text(),
  description_ar: model.text().nullable(),
  occurred_at: model.dateTime(),
  raw: model.json().nullable(),
}).indexes([
  { on: ["fulfillment_id"] },
  { on: ["tracking_number"] },
]);

export default ShipmentEvent;
