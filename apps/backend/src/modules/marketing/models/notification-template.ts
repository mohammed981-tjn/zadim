import { model } from "@medusajs/framework/utils";

/**
 * قالبُ رسالة — **نصٌّ بيانات، وبلغتين**.
 *
 * ── ولماذا في القاعدة لا في ملفّات ──────────────────────────────
 *
 * نصُّ رسالةِ «سلّتُك تنتظرك» يُعدَّل عشرَ مرّاتٍ في شهرٍ واحد: كلمةٌ
 * أدفأ، وسطرٌ يُحذف، وعرضٌ يُضاف. ولو كان في ملفٍّ لكان كلُّ تعديلٍ
 * نشرةَ إصدار.
 *
 * ── واللغتان عمودان لا صفّان ────────────────────────────────────
 *
 * صفٌّ لكل لغةٍ يجعل نصفَ القوالب يُترجَم ونصفَها يُنسى، ولا شيءَ
 * يدلّ على ذلك حتى تصل رسالةٌ فارغةٌ إلى عميل. وعمودان يجعلان النقصَ
 * مرئياً في نفس السطر.
 */
export const NotificationTemplate = model.define("zadim_notification_template", {
  id: model.id({ prefix: "ntpl" }).primaryKey(),

  /** الحدثُ الذي يُشغّله: `PriceDropped` · `BackInStock` · `CartWentQuiet` … */
  event: model.text(),
  channel: model.enum(["email", "sms", "push"]),

  subject_ar: model.text().nullable(),
  subject_en: model.text().nullable(),
  body_ar: model.text(),
  body_en: model.text().nullable(),

  is_active: model.boolean().default(true),
}).indexes([
  { on: ["event", "channel"], unique: true, where: "deleted_at IS NULL" },
]);

export default NotificationTemplate;
