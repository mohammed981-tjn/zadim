import { model } from "@medusajs/framework/utils";

/**
 * إيصالُ استلام — **دفترٌ يُلحَق ولا يُمسّ**، كدفتر حركات المخزون.
 *
 * ── ولماذا دفترٌ لا عدّادٌ على السطر ─────────────────────────────
 *
 * `quantity_received` على السطر عدّادٌ يجيب «كم وصل». وهذا الدفترُ
 * يجيب **«متى وصل، وكم في كل مرّة، ومن استلمه»** — وهو السؤالُ الذي
 * يُطرح يوم يختلف الجردُ عن الورق.
 *
 * وعدّادٌ بلا دفترٍ يجعل خطأً في الاستلام غيرَ قابلٍ للتتبّع: يُصحَّح
 * الرقمُ ويختفي أثرُ الخطأ ومن ارتكبه.
 *
 * والصفُّ لا يُعدَّل ولا يُحذف (قاعدتا `DO INSTEAD NOTHING`): استلامٌ
 * زائدٌ يُصحَّح **بإيصالٍ سالبٍ مقابل** لا بمحوِ الأوّل.
 */
export const PurchaseReceipt = model.define("zadim_purchase_receipt", {
  id: model.id({ prefix: "porcp" }).primaryKey(),

  purchase_order_id: model.text(),
  purchase_order_line_id: model.text(),

  /** موجبٌ استلاماً وسالبٌ تصحيحاً. والصفرُ ليس إيصالاً — يمنعه قيد. */
  quantity: model.number(),

  received_by: model.text().nullable(),
  received_by_label: model.text().nullable(),
  note: model.text().nullable(),
});

export default PurchaseReceipt;
