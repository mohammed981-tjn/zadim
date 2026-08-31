import { model } from "@medusajs/framework/utils";

/**
 * صندوقُ الأحداث الصادرة (`03-state-machines.md` §٥).
 *
 * ── لماذا صندوقٌ لا طابورٌ مباشر ─────────────────────────────────
 *
 * الحدثُ يُكتب في **نفس المعاملة** التي غيّرت الحالة، فإمّا أن يقعا
 * معاً أو لا يقعا. ولا يُرسَل إشعارُ شحنٍ لطلبٍ فشلت كتابتُه، ولا يضيع
 * إشعارٌ لأن الطابور سقط في تلك اللحظة.
 *
 * ── ومن يكتبه؟ **المُطلِق** لا الكود ────────────────────────────
 *
 * حدثٌ يكتبه التطبيق يضيع كلَّما نُسي نداؤه، وضياعُه صامت: الحالةُ
 * تغيّرت والإشعارُ لم يُرسَل، ولا شيءَ يدلّ على ذلك. والمُطلِقُ على
 * `order` يرى **كلَّ** تغيّرِ حالةٍ مهما كان مصدرُه — سيرُ عملٍ، أو
 * مسارٌ مخصَّص، أو `psql` بيدِ مشغّل.
 *
 * ── والحقولُ نوعان ──────────────────────────────────────────────
 *
 * ما وقع (`event` · `payload` · `occurred_at`) **لا يُعدَّل أبداً** —
 * حدثٌ يُعاد كتابتُه ليس سجلّاً. وما يخصّ التسليم (`delivered_at` ·
 * `attempts` · `last_error`) يُكتب مراراً، فهو دفترُ المحاولات لا
 * دفترُ الوقائع. ومُطلِقٌ يفصل بينهما.
 */
export const OutboxEvent = model.define("zadim_outbox_event", {
  id: model.id({ prefix: "evt" }).primaryKey(),

  event: model.text(),
  aggregate_type: model.text(),
  aggregate_id: model.text(),
  payload: model.json().nullable(),
  occurred_at: model.dateTime(),

  delivered_at: model.dateTime().nullable(),
  attempts: model.number().default(0),
  last_error: model.text().nullable(),
}).indexes([
  { on: ["aggregate_type", "aggregate_id"] },
  { on: ["event"] },
]);

export default OutboxEvent;
