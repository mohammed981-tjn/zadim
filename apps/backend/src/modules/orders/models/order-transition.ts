import { model } from "@medusajs/framework/utils";

/**
 * جدولُ الانتقالات — **بيانات لا كود** (`03-state-machines.md` §٦).
 *
 * ── لماذا جدولٌ لا ثابتٌ في ملفّ ──────────────────────────────────
 *
 * الخريطةُ في الكود تُقرأ في المراجعة وتُنسى بعدها، ولا يستطيع أحدٌ أن
 * يسأل القاعدةَ «ما الانتقالاتُ المسموحة؟» فيُجاب. وهنا تُقرأ بجملة
 * `select`، **ويقرؤها المُطلِقُ نفسُه** — فالحارسُ والوثيقةُ شيءٌ واحدٌ
 * لا نسختان تفترقان.
 *
 * ⚠️ **وحالاتُ Medusa هي المستعملة، لا حالاتُ الوثيقة حرفياً**:
 * `order.status` عنده تعداد ثابت (`pending · completed · draft ·
 * archived · canceled · requires_action`) **وليس فيه `confirmed`**.
 * وإضافةُ قيمةٍ إلى تعدادٍ لا نملكه دَينٌ يُدفع في أوّل ترقية. فـ
 * «مؤكَّد» في وثيقتنا هو الزوج (`pending` + دفعٌ محصَّل) — والمحورُ
 * الماليّ منفصلٌ أصلاً، وهو كلُّ ما تطلبه الوثيقةُ من الفصل.
 */
export const OrderTransition = model.define("zadim_order_transition", {
  id: model.id({ prefix: "otrn" }).primaryKey(),

  from_status: model.text(),
  to_status: model.text(),

  /** الإلغاءُ بعد الشحن ممنوع: البضاعةُ خرجت، والطريقُ **مرتجعٌ لا إلغاء**. */
  requires_no_shipment: model.boolean().default(false),

  reason_ar: model.text(),
  is_active: model.boolean().default(true),
}).indexes([
  { on: ["from_status", "to_status"], unique: true },
]);

export default OrderTransition;
