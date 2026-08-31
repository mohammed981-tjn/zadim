import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ORDERS_MODULE } from "../../../../modules/orders";
import type OrdersModuleService from "../../../../modules/orders/service";

/**
 * صندوقُ الأحداث — قراءةٌ فقط.
 *
 * يكتبه مُطلِقُ القاعدة في نفس معاملة تغيّر الحالة. ومسارُ كتابةٍ هنا
 * يعني أن سجلَّ «ماذا وقع ومتى» يمكن أن يُملى بيد، فيبطل معناه.
 *
 * و`?pending=true` تُعيد ما لم يُسلَّم — وهو ما يهمّ من يشخّص «لماذا لم
 * يصل الإشعار».
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orders = req.scope.resolve(ORDERS_MODULE) as OrdersModuleService;
  const q = req.query as Record<string, string | undefined>;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 500);

  if (q.pending === "true") {
    const events = await orders.pendingEvents(limit);
    return res.json({ events, count: events.length, pending_only: true });
  }

  const filters: Record<string, unknown> = {};
  if (q.aggregate_id) filters.aggregate_id = q.aggregate_id;
  if (q.event) filters.event = q.event;

  const [events, count] = await orders.listAndCountOutboxEvents(filters, {
    take: limit,
    order: { occurred_at: "DESC" },
  });

  res.json({ events, count, limit, pending_only: false });
}
