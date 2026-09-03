import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { identityFromToken } from "../../../../../../modules/checkout/identity";

/**
 * حذفُ عنوانٍ محفوظ — `DELETE /store/customers/me/national-addresses/:address_id`.
 *
 * 🔴 **والمِلكيّةُ تُفحص قبل الحذف.** معرّفُ العنوان يأتي من المسار،
 * ومن يخمّن معرّفاً — أو يقرأه من مكانٍ آخر — يحذف عنوانَ غيره.
 * فيُقرأ الصفُّ أوّلاً ويُقابَل `customer_id` برمز الجلسة.
 *
 * ⚠️ **ويُردّ ٤٠٤ لا ٤٠٣ لعنوانِ غيره**: «ممنوع» تخبر المُخمِّن أن
 * المعرّفَ صحيح، فيمضي يجمع معرّفاتٍ صالحة. و«غير موجود» لا تخبره
 * شيئاً — وهو نفسُ منطق «رسالةٍ واحدةٍ للـ٤٠١» في `auth-actions.ts`.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ أوّلاً." },
    });
  }

  const addressId = req.params.address_id;
  const customerModule: any = req.scope.resolve(Modules.CUSTOMER);
  const [row] = await customerModule.listCustomerAddresses({ id: addressId }, { take: 1 });

  if (!row || row.customer_id !== identity.customer_id) {
    return res.status(404).json({
      error: { code: "ADDRESS_NOT_FOUND", message_ar: "لا عنوانَ بهذا المعرّف." },
    });
  }

  await customerModule.deleteCustomerAddresses([addressId]);
  return res.json({ id: addressId, deleted: true });
}
