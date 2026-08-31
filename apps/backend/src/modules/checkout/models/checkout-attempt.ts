import { model } from "@medusajs/framework/utils";

/**
 * محاولةُ الإتمام — **حارسُ التكرار** (`Idempotency-Key`).
 *
 * الشبكةُ تسقط بعد أن يصل الطلبَ الخادمَ وقبل أن يصل الردُّ العميل،
 * فيضغط العميلُ «إتمام» ثانيةً. وبلا حارسٍ يصير طلبان وحجزان
 * ودفعتان — **والثانيةُ لا يعرف بها أحدٌ حتى يشتكي العميل**.
 *
 * ── ولماذا صفٌّ يُحجز أوّلاً لا سجلٌّ يُكتب أخيراً ───────────────
 *
 * لو كُتب السجلُّ بعد النجاح لمرّت المحاولةُ الثانية بينما الأولى ما
 * زالت تعمل — وهو **بالضبط** ما يحدث عند ضغطتين متتاليتين. فالمفتاحُ
 * يُدرَج أوّلاً بقيدٍ فريد: الثانيةُ تصطدم به وهي داخل القاعدة، لا في
 * فحصٍ سبق الكتابة.
 */
export const CheckoutAttempt = model.define("zadim_checkout_attempt", {
  id: model.id({ prefix: "ckatt" }).primaryKey(),

  idempotency_key: model.text().unique(),
  cart_id: model.text(),

  status: model.enum(["in_progress", "completed", "failed"]).default("in_progress"),

  order_id: model.text().nullable(),
  /** الردُّ الذي أُعيد أوّلَ مرّة — يُعاد حرفياً عند التكرار. */
  response: model.json().nullable(),
  error_code: model.text().nullable(),
}).indexes([
  { on: ["cart_id"] },
]);

export default CheckoutAttempt;
