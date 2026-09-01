import { model } from "@medusajs/framework/utils";

/**
 * سجلُّ إرسال — **حارسُ «لا تصل الرسالةُ مرّتين»**.
 *
 * نفسُ نمط `zadim_money_operation` (ADR-014) و`checkout_attempt`: المفتاحُ
 * يُحجز بقيدٍ فريدٍ **قبل** الإرسال لا بعده. وبين الفحص والكتابة يمرّ
 * النداءُ الثاني.
 *
 * ── ولماذا يهمّ ─────────────────────────────────────────────────
 *
 * المُرسِلُ يُعيد المحاولةَ حين يسقط المزوّد. وبلا مفتاحٍ تصل رسالتان
 * أو ثلاث. ورسالةٌ مكرّرةٌ لا تُخسر مالاً كتحصيلٍ مكرّر — **لكنها تُخسر
 * العميل**: من يصله «سلّتُك تنتظرك» ثلاث مرّاتٍ في دقيقةٍ يُلغي
 * الاشتراك، ولا يعود.
 */
export const NotificationSend = model.define("zadim_notification_send", {
  id: model.id({ prefix: "nsend" }).primaryKey(),

  /** `${event_id}:${channel}:${recipient}` — يُبنى في مكانٍ واحد. */
  send_key: model.text().unique(),

  event_id: model.text(),
  channel: model.text(),
  recipient: model.text(),

  status: model.enum(["queued", "sent", "failed", "suppressed"]).default("queued"),
  provider: model.text().nullable(),
  error: model.text().nullable(),
}).indexes([
  { on: ["event_id"] },
]);

export default NotificationSend;
