import { model } from "@medusajs/framework/utils";

/**
 * سجلُّ القيود التي فرضناها على جداولٍ لا نملكها.
 *
 * وليس زينةً: قيدٌ نضيفه على جدولِ Medusa **يختفي من المراجعة** — لا
 * يظهر في نماذجنا ولا في نماذجه. فمن يقرأ الكود بعد سنةٍ ويرى قاعدةً
 * ترفض كتابةً لا يجد لها أثراً في أي ملفِ نموذج. وهذا الجدولُ أثرُها.
 */
export const IntegrityCheck = model.define("zadim_integrity_check", {
  id: model.id({ prefix: "intg" }).primaryKey(),
  target_table: model.text(),
  constraint_name: model.text().unique(),
  reason_ar: model.text(),
});

export default IntegrityCheck;
