import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../../../../modules/procurement";
import type ProcurementModuleService from "../../../../modules/procurement/service";

type LineInput = { variant_id?: string; quantity?: number; unit_cost?: number };
type Body = {
  supplier_id?: string;
  location_id?: string;
  expected_at?: string | null;
  note?: string | null;
  lines?: LineInput[];
};

/**
 * أوامرُ الشراء (بند ٣٣).
 *
 * ⚠️ **و`inventory_item_id` يُقرأ هنا لا وقتَ الاستلام.** الوصلةُ بين
 * المتغيّر وعنصر المخزون تُقرأ لحظةَ الإنشاء وتُخزَّن في السطر — فطردٌ
 * واصلٌ لا يضيع لأن أحداً فصل الوصلةَ بينهما بعد إصدار الأمر.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const procurement = req.scope.resolve<ProcurementModuleService>(PROCUREMENT_MODULE);
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.status) filters.status = q.status;
  if (q.supplier_id) filters.supplier_id = q.supplier_id;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const [orders, count] = await procurement.listAndCountPurchaseOrders(filters, {
    take: limit,
    skip: Number(q.offset ?? 0) || 0,
    order: { created_at: "DESC" },
  });
  res.json({ purchase_orders: orders, count });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const procurement = req.scope.resolve<ProcurementModuleService>(PROCUREMENT_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const supplierId = String(body.supplier_id ?? "").trim();
  const locationId = String(body.location_id ?? "").trim();
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!supplierId || !locationId) {
    return res.status(400).json({
      error: { code: "FIELDS_REQUIRED", message_ar: "المورّدُ وموقعُ الاستلام مطلوبان." },
    });
  }
  if (!lines.length) {
    return res.status(400).json({
      error: { code: "LINES_REQUIRED", message_ar: "أضفْ سطراً واحداً على الأقل." },
    });
  }

  // المورّدُ الموقوف لا يُطلب منه: إيقافُه قرارٌ تشغيليّ يُلتفّ عليه
  // بأمرٍ جديدٍ لو لم يُفحص هنا.
  const [supplier] = (await procurement.listSuppliers({ id: supplierId })) as any[];
  if (!supplier) {
    return res.status(404).json({
      error: { code: "SUPPLIER_NOT_FOUND", message_ar: "لا مورّدَ بهذا المعرّف." },
    });
  }
  if (!supplier.active) {
    return res.status(409).json({
      error: { code: "SUPPLIER_INACTIVE", message_ar: "المورّدُ موقوف — فعّلْه قبل الطلب منه." },
    });
  }

  const prepared: Array<{
    variant_id: string;
    inventory_item_id: string;
    quantity_ordered: number;
    unit_cost: number;
  }> = [];

  for (const l of lines) {
    const variantId = String(l.variant_id ?? "").trim();
    const qty = Number(l.quantity);
    const cost = Number(l.unit_cost);

    if (!variantId || !Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({
        error: { code: "LINE_INVALID", message_ar: "كلُّ سطرٍ يحتاج متغيّراً وكميةً موجبةً صحيحة." },
      });
    }
    // بالهللات صحيحةً (ADR-008): «١٩.٩٩» هنا تسعَ عشرةَ هللةً لا تسعةَ
    // عشرَ ريالاً — والفرقُ مئةُ ضعف، فيُرفض ولا يُقرَّب.
    if (!Number.isInteger(cost) || cost < 0) {
      return res.status(400).json({
        error: { code: "COST_INVALID", message_ar: "التكلفةُ بالهللات صحيحةً وغيرِ سالبة." },
      });
    }

    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: variantId },
    });
    const inventoryItemId = (data?.[0] as any)?.inventory_items?.[0]?.inventory_item_id;
    if (!inventoryItemId) {
      // متغيّرٌ بلا عنصرِ مخزونٍ لا يُستلَم إليه شيء. ويُرفض عند الإنشاء
      // لا عند الاستلام: بضاعةٌ واصلةٌ لا موضعَ لها مشكلةُ رفٍّ لا شاشة.
      return res.status(409).json({
        error: {
          code: "VARIANT_NOT_STOCKED",
          message_ar: `المتغيّر ${variantId} بلا عنصرِ مخزون — لا يُستلَم إليه شيء.`,
        },
      });
    }

    prepared.push({
      variant_id: variantId,
      inventory_item_id: inventoryItemId,
      quantity_ordered: qty,
      unit_cost: cost,
    });
  }

  const [order] = (await procurement.createPurchaseOrders([
    {
      supplier_id: supplierId,
      location_id: locationId,
      status: "draft",
      expected_at: body.expected_at ? new Date(body.expected_at) : null,
      note: body.note ?? null,
      created_by: (req as any).auth_context?.actor_id ?? null,
      created_by_label: (req as any).auth_context?.app_metadata?.email ?? null,
    },
  ] as any)) as any[];

  await procurement.createPurchaseOrderLines(
    prepared.map((l) => ({ ...l, purchase_order_id: order.id })) as any
  );

  const total = await procurement.orderTotal(order.id);
  return res.status(201).json({ purchase_order: { ...order, total_halalas: total } });
}
