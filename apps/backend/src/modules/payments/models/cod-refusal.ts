import { model } from "@medusajs/framework/utils";

/**
 * رفضةٌ عند الباب — الواقعةُ التي تُبنى عليها السياسة.
 *
 * ── ولماذا واقعةٌ لا علامةٌ على العميل ──────────────────────────
 *
 * حقلُ `is_blocked` على العميل يجيب «هل يُمنع؟» ولا يجيب **«لماذا،
 * ومتى، وكم مرّة»**. والعميلُ الذي رفض مرّةً قبل سنتين ليس كالذي رفض
 * ثلاثاً هذا الشهر — والحقلُ الواحد يسوّي بينهما.
 *
 * فالوقائعُ تُقيَّد، **والسياسةُ تُطبَّق عليها**: تُرفع العتبةُ أو تُخفض
 * من اللوحة بلا نشرةِ كودٍ ولا مسحِ علاماتٍ من آلاف الصفوف.
 *
 * ⚠️ **والمفتاحُ ليس معرّفَ عميل**: أكثرُ طلبات COD من ضيوفٍ بلا حساب.
 * فيُقيَّد الجوّالُ مطبَّعاً — وهو ما يبقى ثابتاً بين طلبٍ وآخر.
 */
export const CodRefusal = model.define("zadim_cod_refusal", {
  id: model.id({ prefix: "codr" }).primaryKey(),

  /** الجوّالُ مطبَّعاً (أرقامٌ عربية بلا فواصل) — أو البريدُ عند غيابه. */
  customer_key: model.text(),
  customer_id: model.text().nullable(),
  order_id: model.text().nullable(),

  reason_ar: model.text().nullable(),
  recorded_by: model.text().nullable(),
}).indexes([
  { on: ["customer_key"] },
]);

export default CodRefusal;
