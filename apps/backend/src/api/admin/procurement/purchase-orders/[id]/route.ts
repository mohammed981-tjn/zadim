import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PROCUREMENT_MODULE } from "../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../modules/procurement/service";

/**
 * تفصيلُ أمرِ شراءٍ واحد — **بسطوره ومورّده**، لا حقولَ الأمر وحدَها.
 *
 * والشاشةُ التي تستلم بضاعةً تحتاج كلَّ سطرٍ برقمَيه (المطلوب والمستلَم)
 * لا الأمرَ ملخَّصاً — فبلا هذا المسار لا سبيلَ إلى معرفة **أيُّ سطرٍ**
 * يُستلَم إليه.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const procurement = req.scope.resolve<ProcurementModuleService>(PROCUREMENT_MODULE);
  const id = String((req.params as any).id);

  const [order] = (await procurement.listPurchaseOrders({ id })) as any[];
  if (!order) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا أمرَ شراءٍ بهذا المعرّف." },
    });
  }

  const [supplier] = (await procurement.listSuppliers({ id: order.supplier_id })) as any[];
  const lines = await procurement.listPurchaseOrderLines({ purchase_order_id: id });
  const total = await procurement.orderTotal(id);

  res.json({ purchase_order: { ...order, total_halalas: total }, supplier: supplier ?? null, lines });
}
