import { model } from "@medusajs/framework/utils";

/**
 * انتقالاتُ المرتجع — **بياناتٌ لا كود**، كجدول انتقالات الطلب (م٥).
 *
 * ── وحالاتُ Medusa هي المستعملة ─────────────────────────────────
 *
 * `ReturnStatus` عنده تعدادٌ ثابت — قِيس من الحزمة:
 *
 *     open · requested · received · partially_received · canceled
 *
 * **وليس فيه `inspected` ولا `completed`** كما ترسمهما وثيقتُنا
 * (`03-state-machines.md` §٤). وإضافةُ قيمةٍ إلى تعدادٍ لا نملكه دَينٌ
 * يُدفع في أوّل ترقية، و`ALTER TYPE … ADD VALUE` لا يُتراجَع عنه.
 *
 * فالفحصُ عندنا **ليس حالةً بل سجلّاً**: `zadim_return_inspection`.
 * وهو أقوى من حالة — الحالةُ رقمٌ واحدٌ للمرتجع كلِّه، والسجلُّ يفصّل
 * ثلاثَ قطعٍ رجعت: اثنتان سليمتان وواحدةٌ تالفة. ولا يضيع من الوثيقة
 * مطلبُها: **لا رفَّ قبل حكمٍ بشريّ** — وهو محروسٌ بمُطلِقٍ لا بحالة.
 *
 * وهذا الجدولُ يحرس ما تبقّى: **الملغى لا يُستلَم، والمستلَمُ لا يعود
 * طلباً**.
 */
export const ReturnTransition = model.define("zadim_return_transition", {
  id: model.id({ prefix: "rtrn" }).primaryKey(),

  from_status: model.text(),
  to_status: model.text(),

  reason_ar: model.text(),
  is_active: model.boolean().default(true),
}).indexes([
  { on: ["from_status", "to_status"], unique: true },
]);

export default ReturnTransition;
