import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { WAREHOUSE_MODULE } from "../warehouse";
import type WarehouseModuleService from "../warehouse/service";
import { ORDERS_MODULE } from "../orders";
import type OrdersModuleService from "../orders/service";
import { FULFILMENT_MODULE } from "../fulfilment";
import type FulfilmentModuleService from "../fulfilment/service";
import { ZATCA_MODULE } from "../zatca";
import type ZatcaModuleService from "../zatca/service";
import { BULK_MODULE } from "../bulk";
import type BulkModuleService from "../bulk/service";

/**
 * أرقامُ اللوحة.
 *
 * ── بوّابةُ المرحلة ٨: «كلُّ رقمٍ يطابق استعلاماً مباشراً» ──────
 *
 * وهذا شرطٌ أدقُّ ممّا يبدو. لوحاتُ الإدارة تكذب بطريقتين شائعتين:
 *
 * ١. **رقمٌ مخزَّنٌ يتأخّر** — عدّادٌ يُحدَّث بمهمّةٍ ليلية، فيقرأ المديرُ
 *    مبيعاتِ أمس ويظنّها اليوم.
 * ٢. **رقمٌ يُحسب بشروطٍ غير التي يظنّها القارئ** — «الطلبات» تعدّ
 *    الملغاةَ أو لا تعدّها، والفرقُ لا يظهر في الرقم.
 *
 * فكلُّ رقمٍ هنا **يُحسب عند الطلب** من وحدته، والبوّابةُ تُعيد حسابَه
 * **باستعلامٍ مستقلٍّ على القاعدة** وتقارن. واختلافُ الاثنين يعني أن
 * أحدَهما يكذب — ولا يهمّ أيُّهما.
 *
 * ⚠️ **ولا رقمَ مخزَّنٌ هنا إطلاقاً**: لا عدّادَ يُحدَّث، ولا جدولَ
 * تجميعٍ يُصان. ويوم تكبر البيانات يُنقل الحسابُ إلى استعلامٍ واحدٍ
 * أذكى — **لا إلى عدّادٍ يتأخّر**.
 */
export type Metrics = Awaited<ReturnType<typeof computeMetrics>>;

export async function computeMetrics(scope: any) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const inventory = scope.resolve(Modules.INVENTORY);
  const warehouse = scope.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;
  const orders = scope.resolve(ORDERS_MODULE) as OrdersModuleService;
  const ful = scope.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;
  const zatca = scope.resolve(ZATCA_MODULE) as ZatcaModuleService;
  const bulk = scope.resolve(BULK_MODULE) as BulkModuleService;

  // ── الطلبات ───────────────────────────────────────────────────
  const { data: orderRows } = await query.graph({
    entity: "order",
    fields: ["id", "status", "total"],
  });
  const byStatus: Record<string, number> = {};
  let revenue = 0;
  for (const o of orderRows as any[]) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    // الملغى ليس إيراداً. وعدُّه يجعل الرقمَ يكبر كلَّما ساءت الأمور.
    //
    // 🔴 و`Math.round` لكلّ طلبٍ لا للمجموع (ADR-034): مجموعُ Medusa
    // قد يكون كسريَّ الهللة (ضريبةُ ١٥٪ على سعرٍ ليس من مضاعفات
    // العشرين)، والمحصَّلُ فعلاً هو المقرَّب. فإيرادُ اللوحة **مجموعُ ما
    // يُحصَّل**، لا مجموعُ ما يقوله كائنُ السلّة داخلياً.
    //
    // والتقريبُ لكلّ طلبٍ لا مرّةً في النهاية: الطلبُ هو ما يُحصَّل
    // ويُفوتَر، فهو وحدةُ التقريب. وجمعُ الكسور ثم تقريبُها يُعطي رقماً
    // لا يطابق مجموعَ فواتيرنا.
    if (o.status !== "canceled") revenue += Math.round(Number(o.total ?? 0));
  }

  // ── المخزون ───────────────────────────────────────────────────
  const levels = await inventory.listInventoryLevels({}, { take: 100000 });
  let stocked = 0;
  let reserved = 0;
  for (const l of levels as any[]) {
    stocked += Number(l.stocked_quantity);
    reserved += Number(l.reserved_quantity);
  }
  const rules = await warehouse.activeAlertRules();
  const breaches = rules.length
    ? warehouse.findBreaches(
        (levels as any[]).map((l) => ({
          inventory_item_id: l.inventory_item_id,
          location_id: l.location_id,
          stocked_quantity: Number(l.stocked_quantity),
          reserved_quantity: Number(l.reserved_quantity),
        })),
        rules
      )
    : [];

  // ── التنفيذ ───────────────────────────────────────────────────
  const pickLists = await ful.listPickLists({}, { take: 100000 });
  const picksByState: Record<string, number> = {};
  for (const p of pickLists as any[]) {
    picksByState[p.state] = (picksByState[p.state] ?? 0) + 1;
  }

  // ── الأحداثُ غيرُ المسلَّمة ────────────────────────────────────
  const [, pendingEvents] = await orders.listAndCountOutboxEvents({ delivered_at: null });

  // ── الفواتير ──────────────────────────────────────────────────
  const [, invoiceCount] = await zatca.listAndCountZatcaInvoices({});
  const chain = await zatca.verify();

  // ── الدفعات ───────────────────────────────────────────────────
  const bulkOps = await bulk.listBulkOperations({}, { take: 100000 });
  const bulkByStatus: Record<string, number> = {};
  for (const b of bulkOps as any[]) {
    bulkByStatus[b.status] = (bulkByStatus[b.status] ?? 0) + 1;
  }

  return ({
    computed_at: new Date().toISOString(),
    orders: { total: (orderRows as any[]).length, by_status: byStatus, revenue_halalas: revenue },
    inventory: {
      stocked,
      reserved,
      available: stocked - reserved,
      low_stock: breaches.length,
      alert_rules: rules.length,
    },
    fulfilment: { pick_lists: (pickLists as any[]).length, by_state: picksByState },
    events: { pending: pendingEvents },
    invoices: { count: invoiceCount, chain_ok: chain.ok },
    bulk: { total: (bulkOps as any[]).length, by_status: bulkByStatus },
  });
}
