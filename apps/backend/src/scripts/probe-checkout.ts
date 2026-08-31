import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createCartWorkflow,
  refreshCartItemsWorkflow,
  addShippingMethodToCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  completeCartWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * فحصُ استقصاء: **ماذا يفعل Medusa حين يتغيّر السعر بين عرض السلّة
 * وإتمامها؟**
 *
 * البوّابة تقول: «يُرفض قبل أخذ المال بـ`PRICE_CHANGED`». والسؤالُ
 * الذي لا يُبنى شيءٌ قبل جوابه: **هل يرفض Medusa أصلاً، أم يُعيد
 * التسعير بصمتٍ فيدفع العميلُ ما لم يرَه؟**
 *
 * ولا يُخمَّن الجواب. يُقاس.
 *
 * التشغيل: npx medusa exec ./src/scripts/probe-checkout.ts
 */

const CART_FIELDS = [
  "id",
  "currency_code",
  "total",
  "subtotal",
  "tax_total",
  "shipping_total",
  "discount_total",
  "item_total",
  "items.*",
];

/** المبالغُ تعود كائناتِ BigNumber: `===` عليها يقارن الهويّة فيكون
 *  **كاذباً دائماً**. والمقارنةُ التي تكذب دائماً أسوأُ من غيابها. */
const n = (v: any) => Number(v ?? 0);

export default async function probeCheckout({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const regionModule = container.resolve(Modules.REGION);
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  const productModule = container.resolve(Modules.PRODUCT);
  const inventoryModule = container.resolve(Modules.INVENTORY);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);

  const [region] = await regionModule.listRegions({ name: "السعودية" });
  const [channel] = await salesChannelModule.listSalesChannels({ name: "متجر زادم" });
  const [product] = await productModule.listProducts(
    { handle: "zadim-powerbank" },
    { relations: ["variants"] }
  );
  const variant = (product as any).variants[0];

  if (!region || !channel || !variant) {
    throw new Error("[zadim] بذرةُ التجارة ناقصة — شغّل seed-commerce أوّلاً.");
  }

  const readCart = async (id: string) => {
    const { data } = await query.graph({
      entity: "cart",
      fields: CART_FIELDS,
      filters: { id },
    });
    return data[0] as any;
  };

  const newCart = async () => {
    const { result } = await createCartWorkflow(container).run({
      input: {
        region_id: region.id,
        sales_channel_id: channel.id,
        currency_code: "sar",
        email: "probe@zadim.test",
        shipping_address: {
          first_name: "فاحص",
          last_name: "زادم",
          address_1: "طريق الملك فهد",
          city: "الرياض",
          country_code: "sa",
        },
        items: [{ variant_id: variant.id, quantity: 2 }],
      },
    });
    return result.id;
  };

  const addShipping = async (cartId: string) => {
    const [opt] = await fulfillmentModule.listShippingOptions({ name: "توصيل قياسي — الرياض" });
    await addShippingMethodToCartWorkflow(container).run({
      input: { cart_id: cartId, options: [{ id: opt.id }] },
    });
  };

  const payAndComplete = async (cartId: string) => {
    const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cartId },
    });
    await createPaymentSessionsWorkflow(container).run({
      input: { payment_collection_id: collection.id, provider_id: "pp_system_default" },
    });
    const { result } = await completeCartWorkflow(container).run({ input: { id: cartId } });
    return result;
  };

  const setPrice = async (amount: number) => {
    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: [
          { id: variant.id, prices: [{ currency_code: "sar", amount }] },
        ],
      },
    });
  };

  const originalPrice = 12900;

  // ── ١) هل يُعاد التسعير بصمت؟ ─────────────────────────────────
  logger.info("== ١) تغيّرُ السعر بين العرض والإتمام ==");
  await setPrice(originalPrice);

  const cartA = await newCart();
  await addShipping(cartA);
  const quoted = await readCart(cartA);
  logger.info(`   المعروضُ للعميل: total=${quoted.total} (item=${quoted.item_total} tax=${quoted.tax_total} ship=${quoted.shipping_total})`);

  // التاجرُ يرفع السعر ٥٠٪ بينما السلّةُ مفتوحة
  await setPrice(Math.round(originalPrice * 1.5));

  const afterChange = await readCart(cartA);
  logger.info(`   بعد رفع السعر:  total=${n(afterChange.total)} (item=${n(afterChange.item_total)})`);

  n(afterChange.total) === n(quoted.total)
    ? logger.info("   ⇒ السلّةُ **مثبَّتةٌ عند القراءة**: لم يتغيّر المجموع.")
    : logger.error(
        `   ⇒ أُعيد التسعيرُ عند القراءة: ${n(quoted.total)} ⇒ ${n(afterChange.total)}`
      );

  // وهذا ما يفعله متجرُ Medusa فعلاً عند عرض السلّة.
  await refreshCartItemsWorkflow(container).run({ input: { cart_id: cartA } });
  const afterRefresh = await readCart(cartA);
  logger.info(`   بعد التحديث (refreshCartItems): total=${n(afterRefresh.total)}`);

  try {
    const order: any = await payAndComplete(cartA);
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "item_total"],
      filters: { id: order?.id },
    });
    const real = orders[0] as any;
    logger.error(
      `   ⇒ تمّ الطلبُ بلا اعتراض — order=${real?.id} total=${n(real?.total)} ` +
        `(المعروضُ كان ${n(quoted.total)}، والسعرُ الحاليّ يعطي ${n(afterRefresh.total)})`
    );
  } catch (e: any) {
    logger.info(`   ⇒ رُفض الإتمام: ${e?.message}`);
  }

  await setPrice(originalPrice);

  // ── ٢) نفادُ المخزون بين العرض والإتمام ───────────────────────
  logger.info("== ٢) نفادُ المخزون بين العرض والإتمام ==");

  const cartB = await newCart();
  await addShipping(cartB);
  const quotedB = await readCart(cartB);
  logger.info(`   المعروض: total=${quotedB.total}`);

  const { data: itemsData } = await query.graph({
    entity: "product_variant",
    fields: ["id", "inventory_items.inventory_item_id"],
    filters: { id: variant.id },
  });
  const invItemId = (itemsData[0] as any)?.inventory_items?.[0]?.inventory_item_id;
  const levels = await inventoryModule.listInventoryLevels({ inventory_item_id: invItemId });
  const before = levels.map((l: any) => ({
    id: l.id,
    inventory_item_id: l.inventory_item_id,
    location_id: l.location_id,
    stocked_quantity: Number(l.stocked_quantity),
  }));

  for (const l of before) {
    await inventoryModule.updateInventoryLevels([
      {
        inventory_item_id: l.inventory_item_id,
        location_id: l.location_id,
        stocked_quantity: 0,
      },
    ]);
  }

  try {
    const order: any = await payAndComplete(cartB);
    logger.error(`   ⇒ 🔴 **تمّ الطلبُ ولا مخزون** — order=${order?.id}`);
  } catch (e: any) {
    logger.info(`   ⇒ رُفض: ${e?.type ?? "?"} · ${e?.message}`);
  }

  // إعادةُ المخزون
  for (const l of before) {
    await inventoryModule.updateInventoryLevels([
      {
        inventory_item_id: l.inventory_item_id,
        location_id: l.location_id,
        stocked_quantity: l.stocked_quantity,
      },
    ]);
  }

  logger.info("== انتهى الاستقصاء ==");
}
