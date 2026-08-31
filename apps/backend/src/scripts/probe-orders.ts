import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * فحصُ استقصاء للمرحلة ٥: **ماذا يحرس Medusa من آلة الحالات؟**
 *
 * ثلاثةُ أسئلةٍ لا يُبنى شيءٌ قبل جوابها بالتجربة:
 *
 * ١. هل يمنع Medusa انتقالاً ممنوعاً — **`canceled ⇒ pending` مثلاً**؟
 * ٢. هل يمنع إلغاءَ طلبٍ شُحن؟
 * ٣. هل **تتجمّد الفاتورة**: تغييرُ سعر منتجٍ اليوم، هل يغيّر طلبَ أمس؟
 *
 * التشغيل: npx medusa exec ./src/scripts/probe-orders.ts
 */

export default async function probeOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const orderModule = container.resolve(Modules.ORDER);
  const productModule = container.resolve(Modules.PRODUCT);

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "total", "items.id", "items.variant_id", "items.unit_price"],
  });

  if (!orders.length) {
    throw new Error("[zadim] لا طلباتٍ للفحص — شغّل verify-checkout أوّلاً.");
  }

  const target = orders[orders.length - 1] as any;
  logger.info(`الطلب: ${target.id} · status=${target.status} · total=${target.total}`);

  // ── ١) انتقالٌ ممنوع: ألغِ ثم أعِد إلى pending ────────────────
  logger.info("== ١) canceled ⇒ pending ==");

  await orderModule.updateOrders([{ id: target.id, status: "canceled" } as any]);
  const afterCancel = await orderModule.retrieveOrder(target.id);
  logger.info(`   بعد الإلغاء: ${(afterCancel as any).status}`);

  try {
    await orderModule.updateOrders([{ id: target.id, status: "pending" } as any]);
    const revived = await orderModule.retrieveOrder(target.id);
    (revived as any).status === "pending"
      ? logger.error("   ⇒ 🔴 **الملغى عاد حيّاً** — لا حارسَ على الانتقال إطلاقاً.")
      : logger.info(`   ⇒ لم يتغيّر: ${(revived as any).status}`);
  } catch (e: any) {
    logger.info(`   ⇒ رُفض: ${e?.message}`);
  }

  // ── ٢) هل يمنع الإلغاءَ بعد الشحن؟ ───────────────────────────
  logger.info("== ٢) إلغاءٌ بعد شحنة ==");
  const { data: fulfilled } = await query.graph({
    entity: "order",
    fields: ["id", "status", "fulfillments.id", "fulfillments.shipped_at"],
  });
  const shipped = (fulfilled as any[]).find((o) =>
    (o.fulfillments ?? []).some((f: any) => f.shipped_at)
  );
  logger.info(
    shipped
      ? `   طلبٌ مشحونٌ موجود: ${shipped.id}`
      : "   لا طلبَ مشحوناً بعد — يُفحص الحارسُ بشحنةٍ مصطنعة في البوّابة."
  );

  // ── ٣) تجمُّدُ الفاتورة ──────────────────────────────────────
  logger.info("== ٣) تغييرُ السعر اليوم وفاتورةُ أمس ==");

  const item = (target.items ?? [])[0];
  if (item?.variant_id) {
    const [p] = await productModule.listProducts({}, { relations: ["variants"] });
    const before = Number(item.unit_price);
    logger.info(`   سعرُ البند في الطلب: ${before}`);

    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: [
          { id: item.variant_id, prices: [{ currency_code: "sar", amount: before + 5000 }] },
        ],
      },
    });

    const { data: after } = await query.graph({
      entity: "order",
      fields: ["id", "total", "items.unit_price"],
      filters: { id: target.id },
    });
    const nowPrice = Number((after[0] as any).items[0].unit_price);
    const nowTotal = Number((after[0] as any).total);

    nowPrice === before && nowTotal === Number(target.total)
      ? logger.info(`   ⇒ ✅ الفاتورةُ مجمَّدة: ${nowPrice} و total=${nowTotal}`)
      : logger.error(
          `   ⇒ 🔴 **تغيّرت فاتورةُ أمس**: ${before} ⇒ ${nowPrice} · total ${target.total} ⇒ ${nowTotal}`
        );

    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: [
          { id: item.variant_id, prices: [{ currency_code: "sar", amount: before }] },
        ],
      },
    });

    // وهل يمكن **الكتابةُ مباشرةً** على سطر الفاتورة؟
    try {
      await pg.raw(
        `update "zadim"."order_line_item" set "unit_price" = ? where "id" = ?`,
        [before + 9999, item.id]
      );
      const { data: tampered } = await query.graph({
        entity: "order",
        fields: ["items.unit_price"],
        filters: { id: target.id },
      });
      const v = Number((tampered[0] as any).items[0].unit_price);
      v === before
        ? logger.info("   ⇒ الكتابةُ المباشرة على سطر الفاتورة لا تمرّ")
        : logger.error(`   ⇒ 🔴 **سطرُ الفاتورة يُكتب مباشرةً**: صار ${v}`);
      await pg.raw(`update "zadim"."order_line_item" set "unit_price" = ? where "id" = ?`, [
        before,
        item.id,
      ]);
    } catch (e: any) {
      logger.info(`   ⇒ الكتابةُ المباشرة رُفضت: ${e?.message}`);
    }
  }

  // ⚠️ **ولا يُعاد الطلبُ إلى ما كان.** كان هذا السكربتُ يُرجعه، ثم صار
  // الإرجاعُ نفسُه مرفوضاً بعد بناء الحارس — وهو **البرهانُ الأخير**:
  // الملغى لا يُحيا، ولا حتى بيدِ من كتب الحارس.
  logger.info("== انتهى الاستقصاء — والطلبُ يبقى ملغىً، فذاك ما يعنيه الإلغاء ==");
}
