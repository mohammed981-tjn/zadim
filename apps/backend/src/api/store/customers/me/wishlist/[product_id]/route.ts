import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { WISHLIST_MODULE } from "../../../../../../modules/wishlist";
import type WishlistModuleService from "../../../../../../modules/wishlist/service";
import { identityFromToken } from "../../../../../../modules/checkout/identity";

/**
 * حذفٌ من المفضّلة — `DELETE /store/customers/me/wishlist/:product_id`.
 *
 * ⚠️ **والمفتاحُ هنا معرّفُ المنتج لا معرّفُ الصفّ.** والسببُ أن الذي
 * يضغط القلبَ ثانيةً على صفحة منتجٍ يعرف المنتجَ ولا يعرف صفَّه — وطلبُ
 * معرّفِ الصفّ يُلزم الواجهةَ بقراءةِ القائمة كلِّها قبل كلّ إلغاء.
 *
 * 🔴 **ولا حاجةَ لفحص مِلكيّة** لأن الحذفَ **مقيَّدٌ بصاحب الجلسة**:
 * `remove(customer_id, product_id)` لا تقبل معرّفَ صفٍّ من الخارج
 * أصلاً، فلا سبيلَ إلى صفّ غيره. وهذا أقوى من فحصٍ يُنسى.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ أوّلاً." },
    });
  }

  const wishlist = req.scope.resolve<WishlistModuleService>(WISHLIST_MODULE);
  const removed = await wishlist.remove(identity.customer_id, req.params.product_id);

  // ٢٠٠ في الحالين: المطلوبُ ألّا يكون في مفضّلته، وهو ليس فيها.
  // و٤٠٤ هنا تجعل الواجهةَ تعرض خطأً لمن ضغط مرّتين — وقد نجح.
  res.json({ product_id: req.params.product_id, removed });
}
