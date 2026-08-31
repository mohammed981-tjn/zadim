import { model } from "@medusajs/framework/utils";

/**
 * إعداداتُ الفوترة — **يملؤها المالك، ولا قيمةَ افتراضيةَ لواحدٍ منها**.
 *
 * ── لماذا لا افتراضيّات ─────────────────────────────────────────
 *
 * رقمٌ ضريبيٌّ افتراضيّ في إعدادٍ يُنسى يُطبع على فاتورةٍ تصل الهيئة.
 * واسمُ بائعٍ «متجر تجريبي» يُطبع على فاتورةِ عميلٍ حقيقيّ. فالغيابُ
 * **يمنع الإصدار** ولا يملأ الفراغَ بشيء (بند ٤٨).
 *
 * ── وما لا يُحسم هنا ────────────────────────────────────────────
 *
 * هل المنشأةُ مسجَّلةٌ في ضريبة القيمة المضافة؟ وفي أيّ موجةٍ من المرحلة
 * الثانية تقع؟ **أسئلةٌ يجيبها المالكُ والمحاسب** لا المهندس
 * (`06-saudi-layer.md` §١).
 */
export const ZatcaSetting = model.define("zadim_zatca_setting", {
  id: model.id({ prefix: "zset" }).primaryKey(),

  seller_name: model.text(),
  /** خمسةَ عشرَ رقماً. */
  vat_number: model.text(),

  address_street: model.text().nullable(),
  address_district: model.text().nullable(),
  address_city: model.text().nullable(),
  address_postal_code: model.text().nullable(),
  address_building_number: model.text().nullable(),
  commercial_registration: model.text().nullable(),

  /** المرحلة: `phase_1` إصدارٌ ورمزُ QR · `phase_2` ربطٌ بمزوّدٍ معتمد. */
  phase: model.enum(["phase_1", "phase_2"]).default("phase_1"),

  /** معرّفُ المزوّد المعتمد حين يُربط. `null` = لا ربطَ بعد. */
  provider_id: model.text().nullable(),

  is_enabled: model.boolean().default(false),
});

export default ZatcaSetting;
