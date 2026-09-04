import { model } from "@medusajs/framework/utils";

/**
 * دليلُ الحسابات — **بيانات لا كود** (بند ٤٨).
 *
 * والحساباتُ تنمو مع العمل: يومَ يصل مزوّدُ دفعٍ يلزم «رسومُ البوّابة»،
 * ويومَ تبدأ العضويةُ يلزم «إيرادٌ مؤجَّل». ولو كانت `enum` في الكود
 * لكان كلُّ حسابٍ جديدٍ هجرةً ونشراً ودفعة.
 *
 * ⚠️ **و`normal_side` ليس زينة**: هو الذي يجعل تقريراً يعرف أن رصيدَ
 * «الإيراد» السالبَ **طبيعيٌّ** لا عطب. وبدونه يقرأ القارئُ إيراداً
 * بالسالب فيظنّ الدفترَ مقلوباً.
 */
export const LedgerAccount = model.define("zadim_ledger_account", {
  /** المفتاحُ نصٌّ مقروء (`revenue_items`) لا رقمٌ مبهم. */
  id: model.text().primaryKey(),

  name_ar: model.text(),

  /** `asset` · `liability` · `equity` · `revenue` · `expense`. */
  type: model.text(),

  /** `debit` أو `credit` — الجهةُ التي يكبر فيها الحساب طبيعياً. */
  normal_side: model.text(),

  is_active: model.boolean().default(true),
});

export default LedgerAccount;
