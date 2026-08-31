import { model } from "@medusajs/framework/utils";

/**
 * ملفُّ المستودع — ما يحتاجه **اختيارُ المستودع** ولا يحفظه Medusa.
 *
 * `stock_location` عنده اسمٌ وعنوان، ولا أولويةَ فيه ولا مدينةَ قابلةً
 * للمطابقة ولا مفتاحَ تعطيل. وهذه الثلاثةُ هي كلُّ ما يقرّر «من أين
 * يُشحن هذا الطلب».
 *
 * ── ومستودعٌ بلا ملفّ؟ ───────────────────────────────────────────
 *
 * **يُشحن منه.** ولا تُرفض الشحنةُ لأن أحداً لم يملأ استمارة — فذاك
 * بيعٌ ضائعٌ لسببٍ إداريّ. الملفُّ **يُرتّب** ولا **يأذن**؛ والمنعُ
 * صريحٌ وحده: `is_fulfilment_enabled = false`.
 */
export const LocationProfile = model.define("zadim_location_profile", {
  id: model.id({ prefix: "lprof" }).primaryKey(),

  // معرّفُ `stock_location` عند Medusa. ولا مفتاحَ أجنبيّاً إليه: جدولُ
  // وحدةٍ أخرى، وربطُ الوحدات عند Medusa بالروابط لا بالمفاتيح.
  location_id: model.text().unique(),

  // المدينةُ للمطابقة مع عنوان العميل — أقربُ مستودعٍ أسرعُ وأرخص.
  city: model.text().nullable(),
  region_code: model.text().nullable(),

  // الأعلى أوّلاً. والرقمُ **بيانات**: المديرُ يرفع مستودعاً ويخفض آخر
  // بلا نشرة (بند ٤٨).
  priority: model.number().default(0),

  is_fulfilment_enabled: model.boolean().default(true),

  /**
   * 🔴 **موقعُ الحجر — حيث ينزل الراجعُ ولا يُباع** (بوّابة المرحلة ١٠).
   *
   * ولماذا علمٌ ثانٍ ولا يكفي `is_fulfilment_enabled = false`: المعنيان
   * مختلفان، وخلطُهما يُفقد أحدَهما.
   *
   * «موقوفٌ عن الشحن» **حالٌ مؤقّتة** — جردٌ أو عطلُ رفوف — ويُطفئها
   * المديرُ صباحاً بلا تفكير. ولو كان الحجرُ محمولاً على نفس العلم
   * لصار **إطفاؤه بيعاً لبضاعةٍ لم تُفحص**: نقرةٌ واحدةٌ تبدو روتيناً
   * وتُخرج التالفَ إلى عميلٍ ثانٍ.
   *
   * فالحجرُ صفةُ المكان لا حالُه، ولا تُطفأ بنقرةِ صباح.
   */
  is_returns_location: model.boolean().default(false),

  // يظهر للعميل: «يشحن من الرياض».
  display_name_ar: model.text().nullable(),
}).indexes([
  { on: ["city"] },
  { on: ["priority"] },
  { on: ["is_returns_location"] },
]);

export default LocationProfile;
