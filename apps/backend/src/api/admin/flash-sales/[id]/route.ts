import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { COUPON_POLICY_MODULE } from "../../../../modules/promotions";
import type PromotionsPolicyService from "../../../../modules/promotions/service";

/**
 * `POST|DELETE /admin/flash-sales/:id` — تعديلُ تخفيضٍ خاطفٍ أو إيقافُه.
 *
 * ⚠️ **ولا يُحذف صفُّه ما دامت له مطالبات**: الحذفُ يُيتّم دفترَ
 * المطالبات فلا يُعرف على أيّ سقفٍ جرت. والإيقافُ `is_active = false`
 * يمنع الجديدَ ويُبقي الأثر — وهو ما يريده المديرُ حين يقول «أوقفه».
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const policies = req.scope.resolve(COUPON_POLICY_MODULE) as PromotionsPolicyService;
  const id = req.params.id;
  const body = (req.body ?? {}) as Record<string, any>;

  const [existing] = (await policies.listFlashSales({ id })) as any[];
  if (!existing) {
    res.status(404).json({ code: "FLASH_NOT_FOUND", message_ar: "لا تخفيضَ بهذا المعرّف." });
    return;
  }

  const patch: Record<string, any> = { id };
  if (body.starts_at !== undefined) patch.starts_at = new Date(body.starts_at);
  if (body.ends_at !== undefined) patch.ends_at = new Date(body.ends_at);
  if (body.quantity_limit !== undefined)
    patch.quantity_limit = body.quantity_limit === null || body.quantity_limit === "" ? null : Number(body.quantity_limit);
  if (body.per_customer_limit !== undefined)
    patch.per_customer_limit =
      body.per_customer_limit === null || body.per_customer_limit === "" ? null : Number(body.per_customer_limit);
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  // ⚠️ وخفضُ السقف تحت ما بِيع **لا يُلغي ما بِيع**: الحارسُ يقارن
  // المجموعَ بالسقف الجديد فيمنع الجديدَ وحدَه. ويُقال للمدير صراحةً
  // كي لا يظنّ أنه استرجع قطعاً.
  const claimed = await policies.flashClaimed(id);
  const newLimit = patch.quantity_limit ?? existing.quantity_limit;
  const warning =
    newLimit != null && claimed > Number(newLimit)
      ? `السقفُ الجديد (${newLimit}) دون ما طُولب به فعلاً (${claimed}) — يمنع الجديدَ ولا يُلغي ما بِيع.`
      : null;

  try {
    await policies.updateFlashSales(patch as any);
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
    if (/zadim_flash_sale_window_check/.test(raw)) {
      res.status(400).json({ code: "WINDOW_INVALID", message_ar: "نهايةُ العرض يجب أن تكون بعد بدايته." });
      return;
    }
    if (/qty_check|per_customer_check/.test(raw)) {
      res.status(400).json({ code: "LIMIT_INVALID", message_ar: "الحدُّ رقمٌ أكبرُ من صفر." });
      return;
    }
    throw e;
  }

  const [updated] = (await policies.listFlashSales({ id })) as any[];
  res.json({ flash_sale: updated, claimed, warning_ar: warning });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const policies = req.scope.resolve(COUPON_POLICY_MODULE) as PromotionsPolicyService;
  const id = req.params.id;

  const claimed = await policies.flashClaimed(id);
  if (claimed !== 0) {
    res.status(409).json({
      code: "FLASH_HAS_CLAIMS",
      message_ar: `طُولب بـ${claimed} قطعةً من هذا العرض — أوقفه بدل حذفه كي يبقى الأثر.`,
    });
    return;
  }

  await policies.deleteFlashSales(id);
  res.json({ id, deleted: true });
}
