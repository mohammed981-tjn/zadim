import { model } from "@medusajs/framework/utils";

/**
 * مرادفاتُ البحث — **بيانات لا كود** (ADR-006).
 *
 * وهي الجسرُ الذي لا يبنيه أيُّ تطبيع: «ايفون» عربيةٌ و`iPhone`
 * لاتينية، ولا جذرَ لغويّاً يجمعهما. فالمديرُ يضيف المجموعة حين يرى
 * في تقرير «بحثٌ بلا نتيجة» ما يطلبه الناس ولا يجدونه — بلا نشرةِ
 * كودٍ لكل علامةٍ تجارية جديدة.
 *
 * والمجموعةُ **متكافئةٌ في الاتجاهين**: من طابق أيَّ عضوٍ فيها أخذها
 * كلَّها.
 */
export const SearchSynonym = model.define("zadim_search_synonym", {
  id: model.id({ prefix: "syn" }).primaryKey(),
  term: model.text(),
  // مطبَّعٌ عند الكتابة — فمدخلُ المدير «آيفون» يُطابق بحثَ المستخدم
  // «ايفون» بلا أن يعرف أحدُهما بالآخر.
  term_normalized: model.text(),
  // `array` لا `json`: يُنتج `text[]` حقيقياً — أدقُّ نوعاً، ويقبل
  // الفهرسةَ بـGIN لو احتجناها، ولا يُجبرنا على نمطِ كائنٍ لقائمةِ نصوص.
  synonyms: model.array(),
  is_active: model.boolean().default(true),
}).indexes([
  { on: ["term_normalized"] },
]);

export default SearchSynonym;
