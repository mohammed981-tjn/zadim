import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";
import { BULK_MODULE } from "../../../../../modules/bulk";
import type BulkModuleService from "../../../../../modules/bulk/service";

/**
 * التراجعُ عن دفعة.
 *
 * 🔴 **ولا يمحو عملَ غيرك**: بين الدفعة والتراجع قد يكون أحدٌ عدّل
 * صنفاً بيده. فيُقرأ الحاليُّ أوّلاً — إن ساوى ما كتبته الدفعةُ فهو
 * ملكُها وتُعيده، وإن اختلف **يُتخطّى ويُعلَن في الردّ**.
 *
 * وتراجعٌ أعمى يُعيد القيمةَ القديمة فيمحو تعديلَ زميلٍ **بلا أن يعلم
 * أحدُهما** — وذاك أسوأُ من ألّا يُتراجَع أصلاً.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const bulk = req.scope.resolve(BULK_MODULE) as BulkModuleService;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const [op] = await bulk.listBulkOperations({ id: req.params.id });
  if (!op) {
    return res.status(404).json({
      error: { code: "BULK_NOT_FOUND", message_ar: "لا دفعةَ بهذا المعرّف." },
    });
  }

  const read = async (entityId: string, field: string): Promise<string | null> => {
    const currency = field.split(":")[1] ?? "sar";
    const { data } = await query.graph({
      entity: "variant",
      fields: ["id", "calculated_price.*"],
      filters: { id: [entityId] },
      context: { calculated_price: QueryContext({ currency_code: currency }) },
    });
    const amount = (data[0] as any)?.calculated_price?.calculated_amount;
    return amount === null || amount === undefined ? null : String(Math.round(Number(amount)));
  };

  const write = async (c: { entity_id: string; field: string; new_value: string | null }) => {
    const currency = c.field.split(":")[1] ?? "sar";
    await updateProductVariantsWorkflow(req.scope).run({
      input: {
        product_variants: [
          {
            id: c.entity_id,
            prices: [{ currency_code: currency, amount: Number(c.new_value) }],
          },
        ],
      },
    });
  };

  try {
    const result = await bulk.revert(req.params.id, read, write as any);
    return res.json({
      operation_id: req.params.id,
      ...result,
      message_ar:
        result.skipped > 0
          ? `أُعيد ${result.reverted} صنفاً، و${result.skipped} تغيّرت بعد الدفعة فلم تُعَد.`
          : `أُعيد ${result.reverted} صنفاً.`,
    });
  } catch (e: any) {
    return res.status(409).json({
      error: { code: "REVERT_NOT_ALLOWED", message_ar: String(e?.message ?? "") },
    });
  }
}
