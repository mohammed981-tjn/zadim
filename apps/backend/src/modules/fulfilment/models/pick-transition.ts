import { model } from "@medusajs/framework/utils";

/**
 * انتقالاتُ قائمة اللقط — **بيانات**، كما في آلة حالات الطلب
 * ([ADR-016](../../../../docs/00-decisions.md)).
 *
 * وليس تكراراً للنمط بلا سبب: شاشةُ المستودع تبني أزرارَها من هنا،
 * وبعضُ المتاجر تتخطّى خطوةً (لا تغليفَ منفصلاً مثلاً). وخريطةٌ في
 * الكود تعني نشرةً لتغيير مسارِ عملٍ داخل مستودع.
 */
export const PickTransition = model.define("zadim_pick_transition", {
  id: model.id({ prefix: "ptrn" }).primaryKey(),

  from_state: model.text(),
  to_state: model.text(),
  /** `picked` تشترط اكتمالَ اللقط لكل بند — ولا تمرّ ناقصة. */
  requires_complete: model.boolean().default(false),
  reason_ar: model.text(),
  is_active: model.boolean().default(true),
}).indexes([
  { on: ["from_state", "to_state"], unique: true },
]);

export default PickTransition;
