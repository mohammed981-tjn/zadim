import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * الاستقصاء الثاني: **المسارُ الحقيقي** — بقفلِ Medusa لا بدونه.
 *
 * الاستقصاء الأول (`probe-oversell.ts`) نادى خدمةَ المخزون مباشرةً
 * فباعت زائداً بفظاعة. لكنّ الطلبَ الحقيقي لا يمرّ من هناك: خطوةُ
 * `reserveInventoryStep` تلفّ الحجزَ بـ`locking.execute` على معرّف
 * المادة.
 *
 * فهذا يقيس المسارَ الذي يسلكه العميل فعلاً.
 *
 * ⚠️ **وقيدٌ يجب أن يُقاس لا يُفترض**: مزوّدُ القفل الافتراضي
 * **في الذاكرة** — يحرس عمليةً واحدة. وخادمان يعملان معاً لا يريان
 * قفلَ بعضهما.
 *
 * التشغيل: npx medusa exec ./src/scripts/probe-oversell-workflow.ts
 */

const STOCK = 10;
const ATTEMPTS = 100;

export default async function probe({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const inventory = container.resolve(Modules.INVENTORY);
  const stockLocation = container.resolve(Modules.STOCK_LOCATION);
  const locking = container.resolve(Modules.LOCKING);

  const tag = `wf-${Date.now()}`;
  const [location] = await stockLocation.createStockLocations([{ name: `مستودع ${tag}` }]);
  const [item] = await inventory.createInventoryItems([{ sku: `SKU-${tag}` }]);
  await inventory.createInventoryLevels([
    { inventory_item_id: item.id, location_id: location.id, stocked_quantity: STOCK },
  ]);

  logger.info(`المخزون: ${STOCK} · محاولاتٌ متزامنة: ${ATTEMPTS} · بقفلِ Medusa`);

  /**
   * نفسُ ما تفعله `reserveInventoryStep`: قفلٌ على معرّف المادة، ثم
   * تأكيدُ التوفّر، ثم الحجز.
   */
  const attempt = async (i: number) =>
    locking.execute([item.id], async () => {
      const enough = await inventory.confirmInventory(item.id, [location.id], 1);
      if (!enough) throw new Error("OUT_OF_STOCK");
      return await inventory.createReservationItems([
        {
          inventory_item_id: item.id,
          location_id: location.id,
          quantity: 1,
          description: `محاولة ${i}`,
        },
      ]);
    });

  const results = await Promise.allSettled(
    Array.from({ length: ATTEMPTS }, (_, i) => attempt(i))
  );

  const ok = results.filter((r) => r.status === "fulfilled").length;
  const [level] = await inventory.listInventoryLevels({ inventory_item_id: item.id });
  const stocked = Number((level as any).stocked_quantity);
  const reserved = Number((level as any).reserved_quantity);
  const rows = await inventory.listReservationItems({ inventory_item_id: item.id });

  logger.info("");
  logger.info(`  نجحت: ${ok} · رُفضت: ${ATTEMPTS - ok}`);
  logger.info(`  stocked=${stocked} reserved=${reserved} available=${stocked - reserved}`);
  logger.info(`  صفوفُ الحجز: ${rows.length}`);
  logger.info("");

  ok === STOCK && rows.length === STOCK && reserved === STOCK
    ? logger.info(`  ✅ بالقفل: نجح ${STOCK} بالضبط — لا بيعَ زائد.`)
    : logger.error(
        `  🔴 بالقفل أيضاً: نجح ${ok} وصفوفُ الحجز ${rows.length} والعدّاد ${reserved} — المتوقّع ${STOCK}.`
      );

  if (rows.length) await inventory.deleteReservationItems(rows.map((r: any) => r.id));
  await inventory.deleteInventoryItems([item.id]);
  await stockLocation.deleteStockLocations([location.id]);
}
