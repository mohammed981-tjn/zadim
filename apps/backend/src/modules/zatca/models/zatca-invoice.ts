import { model } from "@medusajs/framework/utils";

/**
 * الفاتورةُ الإلكترونية — حلقةٌ في سلسلةٍ لا صفٌّ مستقلّ.
 *
 * والحمولةُ (`payload`) هي **جوهرُ الجدول** لا حقلاً وصفياً: منها
 * يُولَّد الـXML يوم يُربط مزوّدٌ معتمد، وباكتمالها وحرمتها يصير
 * الانتقالُ إلى المرحلة الثانية ممكناً (`chain.ts`).
 */
export const ZatcaInvoice = model.define("zadim_zatca_invoice", {
  id: model.id({ prefix: "zinv" }).primaryKey(),

  /** تسلسلٌ **غيرُ منقطع** يفرضه مُطلِقٌ في القاعدة. */
  sequence: model.number(),
  uuid: model.text().unique(),
  order_id: model.text().unique(),

  issued_at: model.dateTime(),
  currency_code: model.text(),
  total: model.number(),
  vat_total: model.number(),

  /** كلُّ ما يحتاجه الـXML، محفوظاً لحظةَ الإصدار ولا يُعدَّل. */
  payload: model.json(),

  previous_hash: model.text(),
  invoice_hash: model.text(),
  qr_base64: model.text(),

  /**
   * `issued` = صدرت وفيها رمزُ QR (المرحلة الأولى).
   * `reported` / `cleared` = بُلّغت أو أُجيزت (المرحلة الثانية).
   */
  status: model.enum(["issued", "reported", "cleared", "failed"]).default("issued"),
  provider_ref: model.text().nullable(),
  last_error: model.text().nullable(),
}).indexes([
  { on: ["sequence"], unique: true },
]);

export default ZatcaInvoice;
