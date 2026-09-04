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

  /**
   * 🔴 و`dead` حالةٌ **نهائيةٌ يحرسها مُطلِقٌ** لا عادةُ كود: رسالةٌ
   * بلغت حدَّ المحاولات تُشطب ولا تُعاد أبداً. ولولا الحدُّ لبقي
   * الطابورُ يطرق بابَ عنوانٍ لم يعد موجوداً حتى يُحرَق نطاقُ المتجر
   * عند مزوّدي البريد — وذلك لا يُستدرَك بإصلاح كود.
   */
  /**
   * 🔴 نصُّ الرسالة **كما بُني لحظةَ الحدث** — لا يُعاد بناؤه.
   *
   * لأن الإعادةَ من القالب تُرسل نصّاً ثالثاً: قالبٌ عُدِّل بين
   * المحاولتين يجعل النسخةَ الثانيةَ مختلفةً عن الأولى، والعميلُ
   * يقرأ رسالتين متناقضتين عن حدثٍ واحد. وبلا حفظٍ أصلاً تُعاد
   * **رسالةٌ فارغة** — وهو ما كاد يُشحن.
   */
  subject: model.text().nullable(),
  body: model.text().default(""),

  status: model.enum(["queued", "sent", "failed", "suppressed", "dead"]).default("queued"),
  provider: model.text().nullable(),
  error: model.text().nullable(),

  /**
   * عدّادٌ **تكتبه القاعدة** من دفتر المحاولات لا التطبيق: عدّادٌ يكتبه
   * الكودُ ينحرف عن الدفتر أوّلَ مرّةٍ يسقط فيها بينهما، فيصير الرقمُ
   * الذي يُبنى عليه الشطبُ رقماً لا يقابله شيء.
   */
  attempts: model.number().default(0),
  last_attempt_at: model.dateTime().nullable(),
  /** متى تُعاد. والمهلةُ تتّسع مع كل محاولة فلا يُغرَق مزوّدٌ يتعافى. */
  next_attempt_at: model.dateTime().nullable(),
  dead_at: model.dateTime().nullable(),
}).indexes([
  { on: ["event_id"] },
]);

export default NotificationSend;
