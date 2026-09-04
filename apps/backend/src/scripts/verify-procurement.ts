import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../modules/procurement";
import type ProcurementModuleService from "../modules/procurement/service";
import { FINANCE_MODULE } from "../modules/finance";
import type FinanceModuleService from "../modules/finance/service";
import { placePurchaseOrder, receivePurchaseLine } from "../modules/procurement/receive";

/**
 * بوّابةُ الموردين وأوامر الشراء (بندا ٣٢ و٣٣).
 *
 * ── ونصُّ البند هو ما يُقاس: «أوامرُ الشراء **تزيد المخزون**» ──────
 *
 * فلا يكفي أن توجد الجداولُ ولا أن تُقبل الصفوف. ما يُقاس هنا **أثرٌ
 * على الرفّ**: الموجودُ قبل الاستلام وبعده، والقادمُ قبل وبعد، وسطرٌ
 * في دفتر الحركات سببُه `receipt`، وصفُّ تكلفةٍ صار نافذاً.
 *
 * ولكلّ حارسٍ **شاهدٌ سالب**: تُجرَّب المخالفةُ ويُتأكَّد أنها تُرفض.
 * فحارسٌ لم تُجرَّب مخالفتُه ليس محروساً — هو مكتوبٌ فقط.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-procurement.ts
 */
export default async function verifyProcurement({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const procurement = container.resolve<ProcurementModuleService>(PROCUREMENT_MODULE);
  const finance = container.resolve<FinanceModuleService>(FINANCE_MODULE);
  const productModule = container.resolve(Modules.PRODUCT);
  const stockLocation = container.resolve(Modules.STOCK_LOCATION);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };
  const raises = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (e: any) {
      return String(e?.message ?? e);
    }
  };

  const tag = Date.now().toString(36);
  const [product] = await productModule.listProducts(
    { handle: "zadim-powerbank" },
    { relations: ["variants"] }
  );
  const variant = (product as any)?.variants?.[0];
  const [location] = await stockLocation.listStockLocations({}, { take: 1 });
  if (!variant || !location) {
    throw new Error("[zadim] بذرةُ التجارة ناقصة — شغّل seed-commerce أوّلاً.");
  }

  const { data: vData } = await query.graph({
    entity: "product_variant",
    fields: ["id", "inventory_items.inventory_item_id"],
    filters: { id: variant.id },
  });
  const inventoryItemId = (vData[0] as any)?.inventory_items?.[0]?.inventory_item_id as string;
  if (!inventoryItemId) throw new Error("[zadim] المتغيّرُ بلا عنصرِ مخزون.");

  const levelOf = async () => {
    const rows = await pg.raw(
      `select "id", "stocked_quantity", coalesce("incoming_quantity",0) as incoming
         from "zadim"."inventory_level"
        where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null`,
      [inventoryItemId, location.id]
    );
    return rows?.rows?.[0] ?? null;
  };

  if (!(await levelOf())) {
    throw new Error("[zadim] لا مستوى مخزونٍ للصنف في هذا الموقع — شغّل seed-commerce.");
  }

  const created: string[] = [];

  try {
    // ── ١) المورّد: التفرّدُ على الاسم المطبَّع ─────────────────
    logger.info("== المورّد: تفرّدٌ على المطبَّع لا على الخام ==");

    const supplier = await procurement.createSupplier({ name: `مؤسسة النور ${tag}` });
    (supplier as any)?.id ? pass("مورّدٌ أُنشئ") : fail("تعذّر إنشاءُ مورّد");

    // 🔴 الشاهدُ السالب: نفسُ الاسم بإملاءٍ مختلف (هاء بدل تاء مربوطة)
    // يجب أن يُرفض — وإلا توزّعت مشترياتُ مورّدٍ واحدٍ على صفَّين.
    const dup = await raises(() =>
      procurement.createSupplier({ name: `مؤسسه النور ${tag}` })
    );
    // ⚠️ ويُقبل شكلا الرفض: اصطدامُ الفهرس الخام («duplicate key»)
    // ورسالةُ الـORM المهذّبة («already exists»). فتعبيرٌ يقبل واحداً
    // منهما يسقط لأن الحارسَ نجح بالشكل الآخر — وذاك فحصٌ يقيس صياغةَ
    // رسالةٍ لا سلوكَ نظام.
    dup && /duplicate|unique|already exists/i.test(dup)
      ? pass("والشاهدُ السالب: نفسُ الاسم بإملاءٍ آخر يُرفض")
      : fail(`اسمٌ مكرّرٌ إملائياً مرّ: ${dup ?? "بلا خطأ"}`);

    // ── ٢) المفضَّلُ واحدٌ لكل متغيّر ───────────────────────────
    logger.info("== مورّدٌ مفضَّلٌ واحدٌ لكل متغيّر ==");

    const other = await procurement.createSupplier({ name: `مورّدٌ ثانٍ ${tag}` });
    await procurement.upsertSupplierVariant({
      supplier_id: (supplier as any).id,
      variant_id: variant.id,
      unit_cost: 7000,
      is_preferred: true,
    });
    // ٢أ) التفضيلُ **ينتقل** ولا يسقط — وهو ما يفعله مديرُ المشتريات
    // حين يبدّل مورّدَه. (قِيس أن السلوكَ السابق كان يسقط باصطدام فهرس،
    // أي أنه يعمل مرّةً واحدةً في عمر المتغيّر.)
    const moved = await raises(() =>
      procurement.upsertSupplierVariant({
        supplier_id: (other as any).id,
        variant_id: variant.id,
        unit_cost: 6900,
        is_preferred: true,
      })
    );
    moved === null
      ? pass("تفضيلُ مورّدٍ ثانٍ **ينقل** التفضيل ولا يسقط")
      : fail(`نقلُ التفضيل سقط: ${moved}`);

    // ٢ب) 🔴 والشاهدُ الحاسم: **واحدٌ لا اثنان** — يُعدّ ولا يُفترض.
    const preferred = (await procurement.listSupplierVariants({
      variant_id: variant.id,
      is_preferred: true,
    })) as any[];
    preferred.length === 1 && preferred[0].supplier_id === (other as any).id
      ? pass("والمفضَّلُ واحدٌ فقط، وهو الأخير")
      : fail(`المفضَّلون: ${preferred.length} — ${JSON.stringify(preferred.map((p) => p.supplier_id))}`);

    // ٢ج) والشاهدُ السالب على القيد نفسِه: كتابةٌ مباشرةٌ على القاعدة
    // تتخطّى الخدمة **ويجب أن يوقفها الفهرس** — فالنقلُ راحةُ استعمالٍ
    // لا بديلٌ عن حارس.
    const rawTwo = await raises(() =>
      pg.raw(
        `insert into "zadim"."zadim_supplier_variant"
           ("id","supplier_id","variant_id","unit_cost","lead_time_days","is_preferred")
         values (?, ?, ?, 100, 0, true)`,
        [`supvar_gate_${tag}`, (supplier as any).id, variant.id]
      )
    );
    rawTwo && /duplicate|unique/i.test(rawTwo)
      ? pass("وكتابةٌ مباشرةٌ بمفضَّلٍ ثانٍ يوقفها الفهرس")
      : fail(`الفهرسُ لم يمنع مفضَّلاً ثانياً: ${rawTwo ?? "بلا خطأ"}`);

    // ── ٣) 🔴 البوّابة: أمرُ الشراء **يزيد المخزون** ─────────────
    logger.info("== أمرُ الشراء يزيد المخزون — بالأثر لا بالردّ ==");

    const order = (await procurement.createPurchaseOrders({
      supplier_id: (supplier as any).id,
      location_id: location.id,
      status: "draft",
    } as any)) as any;
    created.push(order.id);

    const ORDERED = 12;
    const UNIT_COST = 6500;
    const line = (await procurement.createPurchaseOrderLines({
      purchase_order_id: order.id,
      variant_id: variant.id,
      inventory_item_id: inventoryItemId,
      quantity_ordered: ORDERED,
      unit_cost: UNIT_COST,
    } as any)) as any;

    const before = await levelOf();

    // ٣أ) الإرسال يحجز القادم
    const placed = await placePurchaseOrder(container, order.id);
    const afterPlace = await levelOf();
    placed.ok ? pass("الأمرُ أُرسل") : fail(`تعذّر الإرسال: ${JSON.stringify(placed)}`);
    Number(afterPlace.incoming) === Number(before.incoming) + ORDERED
      ? pass(`والقادمُ ازداد ${ORDERED} (${before.incoming} ⇐ ${afterPlace.incoming})`)
      : fail(`القادمُ لم يزدْ: ${before.incoming} ⇐ ${afterPlace.incoming}`);
    Number(afterPlace.stocked_quantity) === Number(before.stocked_quantity)
      ? pass("والموجودُ لم يتغيّر — الإرسالُ وعدٌ لا بضاعة")
      : fail(`الموجودُ تغيّر بالإرسال: ${before.stocked_quantity} ⇐ ${afterPlace.stocked_quantity}`);

    // ٣ب) استلامٌ جزئيّ ⇒ الموجودُ يزيد والقادمُ ينقص
    const PART = 5;
    const r1 = await receivePurchaseLine(container, {
      purchase_order_line_id: line.id,
      quantity: PART,
      actor_id: "gate",
    });
    const afterPart = await levelOf();
    r1.ok ? pass(`استُلمت ${PART}`) : fail(`تعذّر الاستلام: ${JSON.stringify(r1)}`);
    Number(afterPart.stocked_quantity) === Number(before.stocked_quantity) + PART
      ? pass(`والموجودُ ازداد ${PART} (${before.stocked_quantity} ⇐ ${afterPart.stocked_quantity})`)
      : fail(`الموجودُ لم يزدْ: ${before.stocked_quantity} ⇐ ${afterPart.stocked_quantity}`);
    Number(afterPart.incoming) === Number(before.incoming) + ORDERED - PART
      ? pass(`والقادمُ نقص ${PART} (${afterPlace.incoming} ⇐ ${afterPart.incoming})`)
      : fail(`القادمُ لم ينقصْ: ${afterPlace.incoming} ⇐ ${afterPart.incoming}`);

    const [poAfterPart] = (await procurement.listPurchaseOrders({ id: order.id })) as any[];
    poAfterPart.status === "partially_received"
      ? pass("وحالةُ الأمر صارت «مستلَمٌ جزئياً» — بمُطلِقِ القاعدة لا بالخدمة")
      : fail(`الحالةُ ${poAfterPart.status} لا partially_received`);

    // ٣ج) دفترُ الحركات — سببٌ ومرجعٌ صحيحان
    const moves = await pg.raw(
      `select "delta","reason","reference_type","reference_id"
         from "zadim"."zadim_stock_movement"
        where "reference_id" = ? order by "created_at" desc limit 1`,
      [order.id]
    );
    const mv = moves?.rows?.[0];
    mv && Number(mv.delta) === PART && mv.reason === "receipt" && mv.reference_type === "purchase_order"
      ? pass(`ودفترُ الحركات قيّدها (delta=${mv.delta} · reason=${mv.reason})`)
      : fail(`دفترُ الحركات: ${JSON.stringify(mv ?? null)}`);

    // ٣د) 🔴 التكلفةُ صارت نافذة — وهذا ما كان يصل الإنتاجَ فارغاً
    const costs = (await finance.listVariantCosts({
      variant_id: variant.id,
      effective_to: null,
    })) as any[];
    const live = costs[0];
    live && Number(live.unit_cost) === UNIT_COST && live.source === "purchase_order"
      ? pass(`وتكلفةُ الوحدة صارت ${UNIT_COST} بمصدرٍ purchase_order`)
      : fail(`التكلفةُ النافذة: ${JSON.stringify(live ?? null)}`);

    // ── ٤) الشواهدُ السالبة على الحرّاس ────────────────────────
    logger.info("== الحرّاس: تُجرَّب المخالفةُ ويُتأكَّد أنها تُرفض ==");

    // ٤أ) استلامٌ يتجاوز المطلوب
    const over = await receivePurchaseLine(container, {
      purchase_order_line_id: line.id,
      quantity: ORDERED - PART + 1,
    });
    const afterOver = await levelOf();
    !over.ok && over.code === "OVER_RECEIPT"
      ? pass("استلامٌ يتجاوز المطلوب يُرفض")
      : fail(`الاستلامُ الزائد مرّ: ${JSON.stringify(over)}`);
    // ⚠️ ويُقاس بالأثر لا بالردّ: رفضٌ يُعيد رسالةً ويزيد المخزونَ خلفها
    // أسوأُ من قبولٍ صريح.
    Number(afterOver.stocked_quantity) === Number(afterPart.stocked_quantity)
      ? pass("ولم يزدْ الموجودُ خلف الرفض")
      : fail(`زاد الموجودُ رغم الرفض: ${afterPart.stocked_quantity} ⇐ ${afterOver.stocked_quantity}`);

    // ٤ب) سطرُ أمرٍ أُرسل لا يُعدَّل
    const edited = await raises(() =>
      procurement.updatePurchaseOrderLines({ id: line.id, unit_cost: 1 } as any)
    );
    edited && edited.includes("zadim:")
      ? pass("وسطرُ أمرٍ أُرسل لا يُعدَّل")
      : fail(`تعديلُ سطرٍ مُرسَلٍ مرّ: ${edited ?? "بلا خطأ"}`);

    // ٤ج) لا إلغاءَ لأمرٍ استُلم منه شيء
    const cancelled = await raises(() =>
      procurement.updatePurchaseOrders({ id: order.id, status: "cancelled" } as any)
    );
    cancelled && cancelled.includes("zadim:")
      ? pass("ولا يُلغى أمرٌ استُلم منه شيء")
      : fail(`إلغاءُ أمرٍ مستلَمٍ مرّ: ${cancelled ?? "بلا خطأ"}`);

    // ٤د) دفترُ الإيصالات يُلحَق ولا يُمسّ
    const receipts = (await procurement.listPurchaseReceipts({
      purchase_order_id: order.id,
    })) as any[];
    const rid = receipts[0]?.id;
    await pg.raw(`update "zadim"."zadim_purchase_receipt" set "quantity" = 999 where "id" = ?`, [rid]);
    await pg.raw(`delete from "zadim"."zadim_purchase_receipt" where "id" = ?`, [rid]);
    const stillThere = await pg.raw(
      `select "quantity" from "zadim"."zadim_purchase_receipt" where "id" = ?`,
      [rid]
    );
    const row = stillThere?.rows?.[0];
    row && Number(row.quantity) === PART
      ? pass("ودفترُ الإيصالات لا يُعدَّل ولا يُحذف")
      : fail(`الإيصالُ تغيّر أو حُذف: ${JSON.stringify(row ?? null)}`);

    // ٤هـ) انتقالٌ ممنوع
    const badJump = await raises(() =>
      procurement.updatePurchaseOrders({ id: order.id, status: "draft" } as any)
    );
    badJump && badJump.includes("zadim:")
      ? pass("والرجوعُ إلى مسوّدةٍ بعد الإرسال يُرفض")
      : fail(`انتقالٌ ممنوعٌ مرّ: ${badJump ?? "بلا خطأ"}`);

    // ── ٥) اكتمالُ الاستلام يُقفل الأمر ────────────────────────
    logger.info("== اكتمالُ الاستلام يُقفل الأمر ==");
    const rest = await receivePurchaseLine(container, {
      purchase_order_line_id: line.id,
      quantity: ORDERED - PART,
    });
    const [poDone] = (await procurement.listPurchaseOrders({ id: order.id })) as any[];
    const afterAll = await levelOf();
    rest.ok && poDone.status === "received"
      ? pass("اكتمل الاستلامُ فصارت الحالةُ «مستلَم»")
      : fail(`بعد الاستلام الكامل: ${poDone.status} · ${JSON.stringify(rest)}`);
    Number(afterAll.stocked_quantity) === Number(before.stocked_quantity) + ORDERED
      ? pass(`والموجودُ ازداد ${ORDERED} كاملةً`)
      : fail(`الموجودُ النهائيّ: ${before.stocked_quantity} ⇐ ${afterAll.stocked_quantity}`);
    Number(afterAll.incoming) === Number(before.incoming)
      ? pass("والقادمُ عاد كما كان — لا وعدَ معلَّق")
      : fail(`القادمُ النهائيّ: ${before.incoming} ⇐ ${afterAll.incoming}`);

    // ── ٦) وإعادةُ الرفّ إلى ما كان ────────────────────────────
    // بوّابةٌ تترك المخزونَ مرتفعاً تُفسد ما بعدها وتُظهر عطباً في فحصٍ
    // بريء (نفسُ ما تفعله بوّابةُ الإتمام بأجرة الشحن).
    await pg.transaction(async (trx: any) => {
      await trx.raw(`select set_config('zadim.movement_reason', 'correction', true)`);
      await trx.raw(
        `update "zadim"."inventory_level" set "stocked_quantity" = ? where "id" = ?`,
        [Number(before.stocked_quantity), before.id]
      );
    });
    const restored = await levelOf();
    Number(restored.stocked_quantity) === Number(before.stocked_quantity)
      ? pass("والرفُّ أُعيد إلى ما كان")
      : fail(`الرفُّ لم يُعدْ: ${restored.stocked_quantity} ≠ ${before.stocked_quantity}`);
  } finally {
    // لا حذفَ للإيصالات (الدفترُ محميّ) — والأوامرُ تبقى شاهدةً كبقيّة
    // ما تُنشئه البوّاباتُ على قاعدةِ تشغيلةٍ تموت معها.
  }

  if (failures) {
    throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص المشتريات.`);
  }
  logger.info("✅ بوّابةُ المشتريات اجتازت — أمرُ الشراء يزيد المخزون، والتكلفةُ تُكتب.");
}
