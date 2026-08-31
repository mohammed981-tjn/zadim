import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * فحصُ استقصاء: **هل يمنع Medusa البيعَ الزائد عند التزاحم؟**
 *
 * السببُ في السؤال: `inventory_level` عند Medusa فيه **صفرُ قيودِ فحص**
 * — لا `stocked_quantity >= 0` ولا `reserved <= stocked`. فالحمايةُ إن
 * وُجدت فهي في التطبيق، والتطبيقُ يقرأ ثم يقرّر ثم يكتب، **وبين
 * القراءة والكتابة يمرّ العميل الثاني**.
 *
 * ولا يُبنى شيءٌ على هذه الطبقة قبل أن يُعرف جوابُها بالتجربة.
 *
 * التشغيل: npx medusa exec ./src/scripts/probe-oversell.ts
 */

const STOCK = 10;
const ATTEMPTS = 100;

export default async function probeOversell({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const inventory = container.resolve(Modules.INVENTORY);
  const stockLocation = container.resolve(Modules.STOCK_LOCATION);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const tag = `probe-${Date.now()}`;

  // موقعٌ ومادةٌ ومستوىً بمخزونٍ = ١٠
  const [location] = await stockLocation.createStockLocations([{ name: `مستودع ${tag}` }]);
  const [item] = await inventory.createInventoryItems([{ sku: `SKU-${tag}` }]);
  await inventory.createInventoryLevels([
    { inventory_item_id: item.id, location_id: location.id, stocked_quantity: STOCK },
  ]);

  logger.info(`المخزون: ${STOCK} · محاولاتٌ متزامنة: ${ATTEMPTS}`);

  // 🔴 التزاحمُ الحقيقي: كلُّ المحاولات تنطلق معاً، بلا انتظارِ بعضها.
  const results = await Promise.allSettled(
    Array.from({ length: ATTEMPTS }, (_, i) =>
      inventory.createReservationItems([
        {
          inventory_item_id: item.id,
          location_id: location.id,
          quantity: 1,
          description: `محاولة ${i}`,
        },
      ])
    )
  );

  const ok = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.length - ok;

  const [level] = await inventory.listInventoryLevels({ inventory_item_id: item.id });
  const stocked = Number((level as any).stocked_quantity);
  const reserved = Number((level as any).reserved_quantity);
  const available = stocked - reserved;

  const rows = await pg.raw(
    `select count(*)::int as n from "zadim"."reservation_item"
     where "inventory_item_id" = ? and "deleted_at" is null`,
    [item.id]
  );
  const reservationRows = (rows?.rows ?? rows)[0]?.n ?? 0;

  logger.info("");
  logger.info(`  نجحت: ${ok} · رُفضت: ${rejected}`);
  logger.info(`  stocked=${stocked} reserved=${reserved} available=${available}`);
  logger.info(`  صفوفُ الحجز في القاعدة: ${reservationRows}`);
  logger.info("");

  if (available < 0 || reserved > stocked) {
    logger.error(`  🔴 بيعٌ زائد: المتاح ${available} — Medusa وحده لا يكفي.`);
  } else if (ok > STOCK) {
    logger.error(`  🔴 نجح ${ok} حجزاً والمخزون ${STOCK} — الحسابُ يكذب.`);
  } else {
    logger.info(`  ✅ لا بيعَ زائد: نجح ${ok} من ${ATTEMPTS} والمتاح ${available}.`);
  }

  // تنظيف
  const reservations = await inventory.listReservationItems({ inventory_item_id: item.id });
  if (reservations.length) await inventory.deleteReservationItems(reservations.map((r: any) => r.id));
  await inventory.deleteInventoryItems([item.id]);
  await stockLocation.deleteStockLocations([location.id]);
}
