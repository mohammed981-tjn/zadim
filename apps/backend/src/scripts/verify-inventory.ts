import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { WAREHOUSE_MODULE } from "../modules/warehouse";
import type WarehouseModuleService from "../modules/warehouse/service";
import { planAllocation, rankLocations } from "../modules/warehouse/allocation";
import { findBreaches, resolveThreshold } from "../modules/warehouse/alerts";

/**
 * بوّابةُ المرحلة ٣ — المخزون (`07-roadmap.md`).
 *
 * > 🔴 **اختبارُ التزاحم إلزاميّ** — ١٠٠ طلبٍ متزامن على مخزونٍ = ١٠
 * > ⇒ عشرةٌ تنجح بالضبط، وتسعون تُرفض، والمخزونُ صفرٌ لا سالب.
 * > ويُشغَّل في CI في كل دفعة، لا مرّةً واحدة.
 *
 * ── ولماذا يُقاس **المسارُ بلا قفل** ────────────────────────────
 *
 * سيرُ عمل Medusa يلفّ الحجزَ بقفل، فيمرّ الاختبارُ بقفلٍ ولو كانت
 * القاعدةُ بلا حارسٍ إطلاقاً. والقياسُ الذي يمرّ لسببٍ غير الذي نظنّه
 * **أسوأُ من ألّا نقيس**: يعطينا ثقةً بحارسٍ لا وجود له.
 *
 * فيُقاس هنا **المسارُ العاري**: نداءٌ مباشرٌ لخدمة المخزون بلا قفل —
 * وهو ما يفعله سكربتُ استيرادٍ أو مسارٌ جديدٌ كتبه من لا يعرف القفل.
 * وقد بِيع فيه قبل الحارس **٩٤ من ١٠** (انظر Migration…0001).
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-inventory.ts
 */

const STOCK = 10;
const ATTEMPTS = 100;

export default async function verifyInventory({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const inventory = container.resolve(Modules.INVENTORY);
  const stockLocation = container.resolve(Modules.STOCK_LOCATION);
  const locking = container.resolve(Modules.LOCKING);
  const warehouse = container.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vinv-${Date.now()}`;
  const madeLocations: string[] = [];
  const madeItems: string[] = [];

  const newLocation = async (name: string) => {
    const [l] = await stockLocation.createStockLocations([{ name: `${name} ${tag}` }]);
    madeLocations.push(l.id);
    return l.id;
  };
  const newItem = async (sku: string) => {
    const [i] = await inventory.createInventoryItems([{ sku: `${sku}-${tag}` }]);
    madeItems.push(i.id);
    return i.id;
  };

  try {
    // ── ١) البوّابة: مئةٌ متزامنةٌ على عشرة، بلا قفل ──────────────
    logger.info("== البوّابة: ١٠٠ محاولةٍ متزامنة على مخزون ١٠ (بلا قفل) ==");

    const gateLoc = await newLocation("مستودع البوّابة");
    const gateItem = await newItem("SKU-GATE");
    await inventory.createInventoryLevels([
      { inventory_item_id: gateItem, location_id: gateLoc, stocked_quantity: STOCK },
    ]);

    const raw = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        inventory.createReservationItems([
          {
            inventory_item_id: gateItem,
            location_id: gateLoc,
            quantity: 1,
            description: `محاولة ${i}`,
          },
        ])
      )
    );

    const okRaw = raw.filter((r) => r.status === "fulfilled").length;
    const rowsRaw = await inventory.listReservationItems({ inventory_item_id: gateItem });
    const [lvlRaw] = await inventory.listInventoryLevels({ inventory_item_id: gateItem });
    const stockedRaw = Number((lvlRaw as any).stocked_quantity);
    const reservedRaw = Number((lvlRaw as any).reserved_quantity);

    logger.info(
      `     نجحت ${okRaw} · رُفضت ${ATTEMPTS - okRaw} · صفوفُ الحجز ${rowsRaw.length} · ` +
        `stocked=${stockedRaw} reserved=${reservedRaw} available=${stockedRaw - reservedRaw}`
    );

    okRaw === STOCK
      ? pass(`نجح ${STOCK} بالضبط ورُفض ${ATTEMPTS - STOCK}`)
      : fail(`نجح ${okRaw} والمتوقّع ${STOCK} — بيعٌ زائد في المسار العاري`);

    rowsRaw.length === STOCK
      ? pass(`صفوفُ الحجز ${STOCK} — الحقيقةُ لا العدّاد`)
      : fail(`صفوفُ الحجز ${rowsRaw.length} والمتوقّع ${STOCK}`);

    stockedRaw >= 0
      ? pass(`الموجود ${stockedRaw} — لا سالب`)
      : fail(`الموجود سالبٌ: ${stockedRaw}`);

    reservedRaw === STOCK
      ? pass(`العدّاد ${reservedRaw} = مجموعُ الحجوزات — لا يَعِد بما نفد`)
      : fail(`العدّاد ${reservedRaw} ومجموعُ الحجوزات ${rowsRaw.length} — عدّادٌ يكذب`);

    // ── ٢) المسارُ الحقيقي: بقفل Medusa ─────────────────────────
    logger.info("== المسارُ الحقيقي: نفسُ الاختبار بقفل Medusa ==");

    const lockLoc = await newLocation("مستودع القفل");
    const lockItem = await newItem("SKU-LOCK");
    await inventory.createInventoryLevels([
      { inventory_item_id: lockItem, location_id: lockLoc, stocked_quantity: STOCK },
    ]);

    const locked = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        locking.execute([lockItem], async () => {
          const enough = await inventory.confirmInventory(lockItem, [lockLoc], 1);
          if (!enough) throw new Error("OUT_OF_STOCK");
          return inventory.createReservationItems([
            {
              inventory_item_id: lockItem,
              location_id: lockLoc,
              quantity: 1,
              description: `محاولة ${i}`,
            },
          ]);
        })
      )
    );

    const okLocked = locked.filter((r) => r.status === "fulfilled").length;
    okLocked === STOCK
      ? pass(`بالقفل: نجح ${STOCK} بالضبط`)
      : fail(`بالقفل: نجح ${okLocked} والمتوقّع ${STOCK}`);

    // ── ٣) الحرّاس في القاعدة ───────────────────────────────────
    logger.info("== حرّاسُ القاعدة ==");

    // موجودٌ سالب
    try {
      await pg.raw(
        `update "zadim"."inventory_level" set "stocked_quantity" = -1 where "inventory_item_id" = ?`,
        [gateItem]
      );
      fail("موجودٌ سالبٌ مُرِّر — القيد لا يعمل");
    } catch {
      pass("موجودٌ سالبٌ يُرفض في القاعدة");
    }

    // حجزٌ على موقعٍ بلا مستوى
    const orphanLoc = await newLocation("مستودع بلا مستوى");
    try {
      await inventory.createReservationItems([
        { inventory_item_id: gateItem, location_id: orphanLoc, quantity: 1 },
      ]);
      fail("حجزٌ على موقعٍ بلا مستوى مُرِّر");
    } catch {
      pass("حجزٌ على موقعٍ بلا مستوى يُرفض");
    }

    // العدّادُ مشتقّ: كتابةُ رقمٍ خاطئٍ مباشرةً تُصحَّح لا تُقبل
    await pg.raw(
      `update "zadim"."inventory_level" set "reserved_quantity" = 3 where "inventory_item_id" = ?`,
      [gateItem]
    );
    const [afterWrite] = await inventory.listInventoryLevels({ inventory_item_id: gateItem });
    Number((afterWrite as any).reserved_quantity) === STOCK
      ? pass("كتابةُ عدّادٍ خاطئ (٣) صُحِّحت إلى المجموع (١٠)")
      : fail(`العدّاد بعد كتابةٍ خاطئة: ${(afterWrite as any).reserved_quantity} — المتوقّع ${STOCK}`);

    // إلغاءُ حجزٍ يُعيد المتاح
    await inventory.deleteReservationItems([rowsRaw[0].id]);
    const [afterCancel] = await inventory.listInventoryLevels({ inventory_item_id: gateItem });
    Number((afterCancel as any).reserved_quantity) === STOCK - 1
      ? pass("إلغاءُ حجزٍ يُعيد المتاح فوراً")
      : fail(`بعد الإلغاء العدّاد ${(afterCancel as any).reserved_quantity} والمتوقّع ${STOCK - 1}`);

    // ── ٤) دفترُ الحركات ────────────────────────────────────────
    logger.info("== دفترُ الحركات ==");

    const ledLoc = await newLocation("مستودع الدفتر");
    const ledItem = await newItem("SKU-LEDGER");
    await inventory.createInventoryLevels([
      { inventory_item_id: ledItem, location_id: ledLoc, stocked_quantity: 40 },
    ]);

    const movesOf = async (item: string) =>
      warehouse.listStockMovements({ inventory_item_id: item }, { order: { created_at: "ASC" } });

    let moves = await movesOf(ledItem);
    moves.length === 1 &&
    Number((moves[0] as any).delta) === 40 &&
    (moves[0] as any).reason === "receipt"
      ? pass("إنشاءُ مستوىً بأربعين ⇒ حركةٌ واحدة (+٤٠ · receipt)")
      : fail(`الدفتر بعد الإنشاء: ${JSON.stringify(moves.map((m: any) => [m.delta, m.reason]))}`);

    await inventory.updateInventoryLevels([
      { inventory_item_id: ledItem, location_id: ledLoc, stocked_quantity: 33 },
    ]);
    moves = await movesOf(ledItem);
    const last = moves[moves.length - 1] as any;
    moves.length === 2 && Number(last.delta) === -7 && Number(last.balance_after) === 33
      ? pass("خفضٌ إلى ٣٣ ⇒ حركةُ (−٧) ورصيدٌ بعدها ٣٣")
      : fail(`الدفتر بعد الخفض: ${JSON.stringify(moves.map((m: any) => [m.delta, m.balance_after]))}`);

    // الحجزُ ليس حركةَ مخزون — الرفُّ لم يتغيّر
    await inventory.createReservationItems([
      { inventory_item_id: ledItem, location_id: ledLoc, quantity: 5 },
    ]);
    moves = await movesOf(ledItem);
    moves.length === 2
      ? pass("الحجزُ لا يُقيَّد في دفتر المخزون — الرفُّ لم يتغيّر")
      : fail(`الحجزُ أضاف حركةً: ${moves.length}`);

    // السببُ من متغيّر الجلسة، داخل معاملةٍ واحدة
    await pg.transaction(async (trx: any) => {
      await trx.raw(`set local "zadim.movement_reason" = 'stocktake'`);
      await trx.raw(
        `update "zadim"."inventory_level" set "stocked_quantity" = 30
          where "inventory_item_id" = ? and "location_id" = ?`,
        [ledItem, ledLoc]
      );
    });
    moves = await movesOf(ledItem);
    (moves[moves.length - 1] as any).reason === "stocktake"
      ? pass("السببُ يُقرأ من متغيّر الجلسة (stocktake)")
      : fail(`السبب المسجَّل: ${(moves[moves.length - 1] as any).reason}`);

    // الدفترُ يُلحَق ولا يُمسّ — في القاعدة
    const target = (await movesOf(ledItem))[0] as any;
    await pg.raw(`update "zadim"."zadim_stock_movement" set "delta" = 999 where "id" = ?`, [
      target.id,
    ]);
    await pg.raw(`delete from "zadim"."zadim_stock_movement" where "id" = ?`, [target.id]);
    const stillThere = await warehouse.listStockMovements({ id: target.id });
    stillThere.length === 1 && Number((stillThere[0] as any).delta) === Number(target.delta)
      ? pass("تعديلُ الدفتر وحذفُه لا يُغيّران شيئاً (DO INSTEAD NOTHING)")
      : fail("الدفترُ قَبِل تعديلاً أو حذفاً");

    // …وفي الكود
    let threw = false;
    try {
      await warehouse.updateStockMovements();
    } catch {
      threw = true;
    }
    threw ? pass("`updateStockMovements` يرمي صراحةً") : fail("`updateStockMovements` لم يرمِ");

    // ── ٥) اختيارُ المستودع ─────────────────────────────────────
    logger.info("== اختيارُ المستودع ==");

    const RY = "loc_riyadh";
    const JD = "loc_jeddah";
    const DM = "loc_dammam";
    const A = "item_a";
    const B = "item_b";

    const profiles = [
      { location_id: RY, city: "الرياض", priority: 5, is_fulfilment_enabled: true },
      { location_id: JD, city: "جدة", priority: 9, is_fulfilment_enabled: true },
      { location_id: DM, city: "الدمام", priority: 99, is_fulfilment_enabled: false },
    ];

    // شحنةٌ واحدةٌ تكفي ⇒ تُفضَّل ولو كان الآخرُ أعلى أولوية
    const p1 = planAllocation({
      lines: [
        { inventory_item_id: A, quantity: 2 },
        { inventory_item_id: B, quantity: 2 },
      ],
      availability: [
        { inventory_item_id: A, location_id: JD, available: 5 },
        { inventory_item_id: A, location_id: RY, available: 5 },
        { inventory_item_id: B, location_id: RY, available: 5 },
      ],
      profiles,
    });
    p1.split_count === 1 && p1.shipments[0].location_id === RY
      ? pass("شحنةٌ واحدةٌ تكفي ⇒ تُفضَّل على الأعلى أولويةً الذي لا يكفي")
      : fail(`الخطّة: ${JSON.stringify(p1.shipments)}`);

    // المدينةُ تسبق الأولوية
    const p2 = planAllocation({
      lines: [{ inventory_item_id: A, quantity: 1 }],
      availability: [
        { inventory_item_id: A, location_id: JD, available: 5 },
        { inventory_item_id: A, location_id: RY, available: 5 },
      ],
      profiles,
      destination_city: "الرياض",
    });
    p2.shipments[0].location_id === RY
      ? pass("مدينةُ العميل تسبق الأولوية")
      : fail(`اختار ${p2.shipments[0]?.location_id} لا الرياض`);

    // وبلا مدينةٍ: الأولوية
    const p3 = planAllocation({
      lines: [{ inventory_item_id: A, quantity: 1 }],
      availability: [
        { inventory_item_id: A, location_id: RY, available: 5 },
        { inventory_item_id: A, location_id: JD, available: 5 },
      ],
      profiles,
    });
    p3.shipments[0].location_id === JD
      ? pass("بلا مدينةٍ: الأولوية الأعلى (جدة ٩)")
      : fail(`اختار ${p3.shipments[0]?.location_id} لا جدة`);

    // المعطَّلُ لا يُشحن منه ولو كانت أولويتُه الأعلى
    const p4 = planAllocation({
      lines: [{ inventory_item_id: A, quantity: 1 }],
      availability: [
        { inventory_item_id: A, location_id: DM, available: 50 },
        { inventory_item_id: A, location_id: RY, available: 1 },
      ],
      profiles,
    });
    p4.shipments[0].location_id === RY
      ? pass("المستودعُ المعطَّل يُستبعد ولو كانت أولويتُه ٩٩")
      : fail(`اختار المعطَّل: ${p4.shipments[0]?.location_id}`);

    // التقسيمُ آخرُ الحلول — لا أوّلها
    const p5 = planAllocation({
      lines: [{ inventory_item_id: A, quantity: 8 }],
      availability: [
        { inventory_item_id: A, location_id: RY, available: 5 },
        { inventory_item_id: A, location_id: JD, available: 5 },
      ],
      profiles,
    });
    p5.split_count === 2 && p5.fully_allocatable && p5.unfulfilled.length === 0
      ? pass("لا مستودعَ يكفي وحده ⇒ يُقسَّم على اثنين ويكتمل")
      : fail(`التقسيم: ${JSON.stringify(p5)}`);

    // النقصُ يُعلَن ولا يُخفى
    const p6 = planAllocation({
      lines: [{ inventory_item_id: A, quantity: 20 }],
      availability: [{ inventory_item_id: A, location_id: RY, available: 5 }],
      profiles,
    });
    !p6.fully_allocatable && p6.unfulfilled[0]?.quantity === 15
      ? pass("النقصُ يُعلَن: ١٥ بلا مستودع")
      : fail(`النقص لم يُعلَن: ${JSON.stringify(p6)}`);

    // مستودعٌ بلا ملفّ يُشحن منه — الملفُّ يُرتّب ولا يأذن
    const p7 = planAllocation({
      lines: [{ inventory_item_id: A, quantity: 1 }],
      availability: [{ inventory_item_id: A, location_id: "loc_unknown", available: 3 }],
      profiles,
    });
    p7.shipments[0]?.location_id === "loc_unknown"
      ? pass("مستودعٌ بلا ملفٍّ يُشحن منه")
      : fail("مستودعٌ بلا ملفٍّ استُبعد");

    // الترتيبُ حاسم: نفسُ المدخل ⇒ نفسُ الترتيب
    const r1 = rankLocations([RY, JD], profiles).join(",");
    const r2 = rankLocations([JD, RY], profiles).join(",");
    r1 === r2
      ? pass("الترتيبُ حاسمٌ لا يتبع ترتيبَ المدخل")
      : fail(`ترتيبان مختلفان: ${r1} ≠ ${r2}`);

    // ── ٦) تنبيهُ النفاد ────────────────────────────────────────
    logger.info("== تنبيهُ النفاد ==");

    const rules = [
      { id: "r_global", scope: "global" as const, threshold_quantity: 2 },
      { id: "r_item", scope: "item" as const, inventory_item_id: A, threshold_quantity: 10 },
      {
        id: "r_both",
        scope: "item_location" as const,
        inventory_item_id: A,
        location_id: RY,
        threshold_quantity: 0,
      },
      {
        id: "r_off",
        scope: "location" as const,
        location_id: JD,
        threshold_quantity: 999,
        is_active: false,
      },
    ];

    resolveThreshold(rules, A, RY)?.id === "r_both"
      ? pass("الأخصُّ يغلب: item_location قبل item قبل global")
      : fail(`اختار ${resolveThreshold(rules, A, RY)?.id} لا r_both`);

    resolveThreshold(rules, A, JD)?.id === "r_item"
      ? pass("قاعدةُ المادة تغلب العامّة")
      : fail(`اختار ${resolveThreshold(rules, A, JD)?.id} لا r_item`);

    resolveThreshold(rules, B, JD)?.id === "r_global"
      ? pass("المعطَّلةُ تُتجاهل وتبقى العامّة")
      : fail(`اختار ${resolveThreshold(rules, B, JD)?.id} لا r_global`);

    // المتاحُ لا الموجود: رفٌّ ممتلئٌ كلُّه محجوزٌ = نفد
    const breaches = findBreaches(
      [
        { inventory_item_id: B, location_id: JD, stocked_quantity: 100, reserved_quantity: 99 },
        { inventory_item_id: B, location_id: RY, stocked_quantity: 50, reserved_quantity: 0 },
      ],
      rules
    );
    breaches.length === 1 && breaches[0].location_id === JD && breaches[0].available === 1
      ? pass("يُقاس المتاحُ لا الموجود: ١٠٠ موجودٍ و٩٩ محجوزاً ⇒ تنبيه")
      : fail(`الخروق: ${JSON.stringify(breaches)}`);

    findBreaches(
      [{ inventory_item_id: B, location_id: JD, stocked_quantity: 0, reserved_quantity: 0 }],
      []
    ).length === 0
      ? pass("بلا قواعدَ: لا تنبيهات — ولا رقمَ افتراضيّ في الكود")
      : fail("تنبيهٌ بلا قاعدة — ثمّةَ رقمٌ مبرمَجٌ في مكانٍ ما");

    // والقواعدُ الحقيقيةُ من القاعدة تمرّ بنفس الدالّة
    const live = await warehouse.activeAlertRules();
    Array.isArray(live)
      ? pass(`قواعدُ القاعدة تُقرأ (${live.length} نشطة)`)
      : fail("قراءةُ القواعد أخفقت");
  } finally {
    // ── تنظيفٌ لا يتّكل على الحذف الناعم ────────────────────────
    // بقايا التجارب أفسدت قاعدةَ التطوير مرّةً وأسقطت هجرةً كاملة
    // (`reserved=94` على مخزون `10`). فالحذفُ حقيقيٌّ وبترتيب التبعيّة.
    //
    // **وحركاتُ الدفتر تبقى**: `DO INSTEAD NOTHING` تُسقط حذفَها بصمت،
    // وهو المطلوب منها. ودفترٌ يُنظّفه اختبارٌ ليس دفتراً — وسطورُه
    // تشير إلى موادَّ مهملة، فلا تُشوّش تقريراً حقيقياً.
    await pg("zadim.reservation_item").whereIn("inventory_item_id", madeItems).del();
    await pg("zadim.inventory_level").whereIn("inventory_item_id", madeItems).del();
    await pg("zadim.inventory_item").whereIn("id", madeItems).del();
    await pg("zadim.stock_location").whereIn("id", madeLocations).del();
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص المخزون.`);
  logger.info("✅ كلُّ فحوص المرحلة ٣ اجتازت — والبوّابةُ مُثبَتةٌ بالقياس لا بالافتراض.");
}
