import { model } from "@medusajs/framework/utils";

/**
 * المورّد (بند ٣٢).
 *
 * ── ولماذا كيانٌ مستقلٌّ لا نصٌّ في أمر الشراء ────────────────────
 *
 * لأن السؤالَ الذي يُطرح بعد سنةٍ ليس «من باعنا هذا الطرد» بل **«كم
 * اشترينا من فلانٍ هذا العام، وبكم، وكم تأخّر»**. واسمٌ مكتوبٌ بيدٍ في
 * كل أمرٍ يجعل هذا السؤالَ بحثاً نصّياً على أخطاء الإملاء.
 *
 * ⚠️ **ولا رقمَ ضريبيٍّ إلزاميّ**: مورّدٌ صغيرٌ غيرُ مسجَّلٍ في الضريبة
 * بائعٌ حقيقيٌّ نشتري منه. وحقلٌ إلزاميٌّ هنا يعني أن يُملأ بصفرٍ أو
 * بشَرطةٍ — فيصير الحقلُ كذبةً مرتَّبة.
 */
export const Supplier = model.define("zadim_supplier", {
  id: model.id({ prefix: "sup" }).primaryKey(),

  name: model.text().searchable(),
  /** الاسمُ المطبَّع للبحث والتفرّد — لا يُعرض. */
  name_normalized: model.text(),

  contact_name: model.text().nullable(),
  phone: model.text().nullable(),
  email: model.text().nullable(),
  /** الرقمُ الضريبيّ — اختياريّ عمداً (انظر أعلاه). */
  tax_number: model.text().nullable(),

  /** مورّدٌ **موقوفٌ لا محذوف**: أوامرُه الماضيةُ تبقى مقروءةً بجهتها. */
  active: model.boolean().default(true),

  note: model.text().nullable(),
});

export default Supplier;
