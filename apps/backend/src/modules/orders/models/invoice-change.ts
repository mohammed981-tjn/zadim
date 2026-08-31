import { model } from "@medusajs/framework/utils";

/**
 * سجلُّ تغيّرات الفاتورة — **من غيّر سطراً في طلبٍ قائم**.
 *
 * ── ما قِيس ─────────────────────────────────────────────────────
 *
 * فاتورةُ أمس **مجمَّدةٌ أمام تغيّر السعر**: `order_line_item` يحمل
 * نسختَه من السعر، فرفعُ سعر المنتج اليوم لا يمسّها. وهذا صحيحٌ
 * ومُثبَت.
 *
 * **لكنّ السطرَ يُكتب مباشرةً**: جملةُ `UPDATE` واحدة تُعيد كتابة فاتورة
 * صدرت — ولا أثرَ لذلك في أيّ مكان.
 *
 * ── ولماذا لا يُمنع مطلقاً ──────────────────────────────────────
 *
 * لأن **تعديلَ الطلب ميزةٌ مشروعة**: المدير يصحّح كمّيةً أو سعراً على
 * طلبٍ قائمٍ لم يُغلق. ومنعٌ مطلقٌ يكسر ميزةً يستعملها الناس كلَّ يوم.
 *
 * فالقاعدة: **المُغلَق لا يُمسّ** (`completed` أو `canceled` ⇒ رفضٌ
 * صريح)، **وما عداه يُسجَّل** — بالقديم والجديد ومتى. فالتغييرُ الصامت
 * يصير مستحيلاً حتى حين يكون مسموحاً.
 */
export const InvoiceChange = model.define("zadim_invoice_change", {
  id: model.id({ prefix: "invch" }).primaryKey(),

  order_id: model.text(),
  line_item_id: model.text(),
  field: model.text(),
  old_value: model.text().nullable(),
  new_value: model.text().nullable(),
  actor_id: model.text().nullable(),
}).indexes([
  { on: ["order_id"] },
]);

export default InvoiceChange;
