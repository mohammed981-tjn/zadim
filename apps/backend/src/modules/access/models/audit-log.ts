import { model } from "@medusajs/framework/utils";

/**
 * سجلّ التدقيق (بند ٤٦).
 *
 * والفرقُ بينه وبين سجلّ الأحداث أنه يحفظ **القيمة قبل والقيمة بعد**:
 * «غيّر محمدٌ السعر من ١٩٩ إلى ١٧٩» لا «عدّل منتجاً». الأولُ يُغلق
 * نزاعاً، والثاني لا يجيب سؤالاً.
 *
 * وثلاثةُ حرّاسٍ عليه:
 *  ١. يُلحَق ولا يُعدَّل ولا يُحذف — بقاعدةٍ في القاعدة نفسها
 *     (migrations/…-audit-log-append-only). سجلُّ تدقيقٍ يمكن تعديلُه
 *     ليس سجلَّ تدقيق.
 *  ٢. `actor_label` نصٌّ **منسوخ** بجانب `actor_id` — فحذفُ المستخدم
 *     بعد سنةٍ لا يجعل السجلّ يقول «صرفه NULL».
 *  ٣. الكتابةُ من طبقةٍ واحدة (`AccessModuleService.record`)، لا من
 *     كلّ مبرمجٍ يتذكّر.
 */
export const AuditLog = model.define("zadim_audit_log", {
  id: model.id({ prefix: "audit" }).primaryKey(),
  actor_id: model.text().nullable(),
  actor_label: model.text(),
  action: model.text(),
  entity: model.text(),
  entity_id: model.text(),
  old_value: model.json().nullable(),
  new_value: model.json().nullable(),
  ip: model.text().nullable(),
  user_agent: model.text().nullable(),
}).indexes([
  { on: ["entity", "entity_id"] },
  { on: ["actor_id"] },
  { on: ["action"] },
]);

export default AuditLog;
