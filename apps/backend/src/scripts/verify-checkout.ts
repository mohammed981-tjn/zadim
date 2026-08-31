import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createCartWorkflow,
  addShippingMethodToCartWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";
import { runCheckout, runQuote } from "../modules/checkout/orchestrate";
import { fingerprint, priceDrift, totalsBalance } from "../modules/checkout/pricing";

/**
 * بوّابةُ المرحلة ٤ — السلّة و Checkout (`07-roadmap.md`).
 *
 * > تغيّرُ السعر أو نفادُ المخزون بين عرض السلّة وإتمامها ⇒ **يُرفض
 * > قبل أخذ المال** بـ`PRICE_CHANGED` أو `OUT_OF_STOCK`، والمجموعُ
 * > يوازن دائماً.
 *
 * ── وما تقيسه هذه البوّابة أكثر من رمز الخطأ ────────────────────
 *
 * أن يُعاد `PRICE_CHANGED` سهل. **والمهمُّ أن لا يُنشأ طلبٌ ولا تُتمّ
 * السلّة**: رفضٌ يُعيد رسالةً ويُنشئ الطلبَ خلفها أسوأُ من قبولٍ صريح،
 * لأنه يبدو آمناً. فكلُّ فحصٍ هنا يعدّ الطلباتِ قبلَه وبعده.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-checkout.ts
 */

export default async function verifyCheckout({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const regionModule = container.resolve(Modules.REGION);
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  const productModule = container.resolve(Modules.PRODUCT);
  const inventoryModule = container.resolve(Modules.INVENTORY);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  // ── ٠) المنطقُ الخالص — بلا سلّةٍ ولا قاعدة ───────────────────
  logger.info("== المنطقُ الخالص ==");

  const lines = [
    { id: "li_1", variant_id: "v_1", title: "أ", quantity: 2, unit_price: 100 },
    { id: "li_2", variant_id: "v_2", title: "ب", quantity: 1, unit_price: 50 },
  ];

  priceDrift(lines, new Map([["v_1", 100], ["v_2", 50]])).length === 0
    ? pass("لا فرقَ حين تتطابق الأسعار")
    : fail("فرقٌ وهميّ على أسعارٍ متطابقة");

  const d1 = priceDrift(lines, new Map([["v_1", 130], ["v_2", 50]]));
  d1.length === 1 && d1[0].difference === 30 && d1[0].variant_id === "v_1"
    ? pass("الارتفاعُ يُلتقط بفرقه (+٣٠)")
    : fail(`الارتفاع: ${JSON.stringify(d1)}`);

  const d2 = priceDrift(lines, new Map([["v_1", 80], ["v_2", 50]]));
  d2.length === 1 && d2[0].difference === -20
    ? pass("**والانخفاضُ أيضاً** — كلُّ اختلافٍ يُعرض، لا الارتفاعُ وحده")
    : fail(`الانخفاض لم يُلتقط: ${JSON.stringify(d2)}`);

  const d3 = priceDrift(lines, new Map<string, number | null>([["v_1", 100], ["v_2", null]]));
  d3.length === 1 && d3[0].variant_id === "v_2"
    ? pass("المتغيّرُ الذي سُحب سعرُه فرقٌ لا يُتجاهل")
    : fail("سعرٌ مسحوبٌ مرّ بلا اعتراض");

  // ⚠️ القيمُ الماليّة تعود كائناتِ BigNumber: `===` عليها يكذب دائماً.
  const bigLike = [{ ...lines[0], unit_price: { toString: () => "100" } as any }];
  priceDrift(bigLike, new Map([["v_1", 100]])).length === 0
    ? pass("BigNumber يُقارَن بقيمته لا بهويّته")
    : fail("مقارنةُ BigNumber تكذب — وهي أخطرُ عطلٍ صامت");

  fingerprint(lines) === fingerprint([lines[1], lines[0]])
    ? pass("البصمةُ لا تتبع ترتيبَ البنود")
    : fail("البصمةُ تتغيّر بترتيبٍ لا معنى له");

  fingerprint(lines) !== fingerprint([{ ...lines[0], quantity: 3 }, lines[1]])
    ? pass("تغيّرُ الكمّية يغيّر البصمة")
    : fail("البصمةُ عمياءُ عن الكمّية");

  const bal = totalsBalance({
    currency_code: "sar",
    item_total: 29670,
    shipping_total: 2875,
    tax_total: 4245,
    discount_total: 0,
    total: 32545,
  });
  bal.ok
    ? pass("توازنُ المجاميع: 29670 + 2875 = 32545")
    : fail(`التوازن أخفق: متوقّع ${bal.expected}`);

  // ── الإعداد ───────────────────────────────────────────────────
  const [region] = await regionModule.listRegions({ name: "السعودية" });
  const [channel] = await salesChannelModule.listSalesChannels({ name: "متجر زادم" });
  const [product] = await productModule.listProducts(
    { handle: "zadim-powerbank" },
    { relations: ["variants"] }
  );
  const variant = (product as any)?.variants?.[0];
  const [shipOption] = await fulfillmentModule.listShippingOptions({
    name: "توصيل قياسي — الرياض",
  });

  if (!region || !channel || !variant || !shipOption) {
    throw new Error("[zadim] بذرةُ التجارة ناقصة — شغّل seed-commerce أوّلاً.");
  }

  const BASE_PRICE = 12900;
  const setPrice = async (a: number) => {
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: [{ id: variant.id, prices: [{ currency_code: "sar", amount: a }] }] },
    });
  };

  const countOrders = async () => {
    const r = await pg.raw(`select count(*)::int as n from "zadim"."order"`);
    return (r?.rows ?? r)[0]?.n ?? 0;
  };

  const newCart = async (qty = 2) => {
    const { result } = await createCartWorkflow(container).run({
      input: {
        region_id: region.id,
        sales_channel_id: channel.id,
        currency_code: "sar",
        email: "gate@zadim.test",
        shipping_address: {
          first_name: "بوّابة",
          last_name: "زادم",
          address_1: "طريق الملك فهد",
          city: "الرياض",
          country_code: "sa",
        },
        items: [{ variant_id: variant.id, quantity: qty }],
      },
    });
    await addShippingMethodToCartWorkflow(container).run({
      input: { cart_id: result.id, options: [{ id: shipOption.id }] },
    });
    return result.id;
  };

  const invItemId = async () => {
    const { data } = await query.graph({
      entity: "variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: variant.id },
    });
    return (data[0] as any)?.inventory_items?.[0]?.inventory_item_id as string;
  };

  const createdCarts: string[] = [];

  try {
    await setPrice(BASE_PRICE);

    // ── ١) تغيّرُ السعر بين العرض والإتمام ──────────────────────
    logger.info("== البوّابة: تغيّرُ السعر ⇒ يُرفض قبل أخذ المال ==");

    const cartA = await newCart();
    createdCarts.push(cartA);

    const q1 = await runQuote(container, cartA);
    const quotedTotal = Number((q1.body as any)?.quote?.total ?? 0);
    q1.status === 201 && quotedTotal > 0
      ? pass(`العرضُ ثُبّت: ${quotedTotal} هللة`)
      : fail(`العرض أخفق: ${JSON.stringify(q1.body)}`);

    await setPrice(Math.round(BASE_PRICE * 1.5));

    const ordersBefore = await countOrders();
    const rejected = await runCheckout(container, cartA);
    const ordersAfter = await countOrders();

    (rejected.body as any)?.error?.code === "PRICE_CHANGED" && rejected.status === 409
      ? pass("تغيّرَ السعرُ ⇒ PRICE_CHANGED بـ409")
      : fail(`المتوقّع PRICE_CHANGED، وجاء: ${JSON.stringify(rejected.body)}`);

    ordersAfter === ordersBefore
      ? pass("**ولم يُنشأ طلب** — الرفضُ قبل أخذ المال لا بعده")
      : fail(`أُنشئ طلبٌ رغم الرفض: ${ordersBefore} ⇒ ${ordersAfter}`);

    const details = (rejected.body as any)?.error?.details?.lines?.[0];
    details && details.difference === Math.round(BASE_PRICE * 1.5) - BASE_PRICE
      ? pass(`والفرقُ معروضٌ للعميل: +${details.difference} هللة`)
      : fail(`الفرق غيرُ معروضٍ أو خاطئ: ${JSON.stringify(details)}`);

    // ── ٢) والعميلُ يقرّر: عرضٌ جديدٌ ثم إتمام ──────────────────
    logger.info("== العميلُ يقبل السعرَ الجديد ==");

    const q2 = await runQuote(container, cartA);
    const newTotal = Number((q2.body as any)?.quote?.total ?? 0);
    newTotal > quotedTotal
      ? pass(`العرضُ الجديد أعلى: ${quotedTotal} ⇒ ${newTotal}`)
      : fail(`العرضُ الجديد لم يرتفع: ${newTotal}`);

    const done = await runCheckout(container, cartA);
    done.status === 201 && (done.body as any)?.order?.id
      ? pass(`تمّ الطلب: ${(done.body as any).order.id}`)
      : fail(`الإتمام أخفق: ${JSON.stringify(done.body)}`);

    Number((done.body as any)?.order?.total) === newTotal
      ? pass("**والمحصَّلُ هو المعروضُ بالضبط** — لا رقمَ ثالث")
      : fail(
          `المحصَّل ${(done.body as any)?.order?.total} والمعروض ${newTotal}`
        );

    const alloc = (done.body as any)?.allocation;
    alloc?.fully_allocatable && alloc?.split_count === 1
      ? pass(`واختيرَ مستودعٌ واحد (${alloc.shipments[0]?.location_id?.slice(0, 12)}…)`)
      : fail(`خطّةُ الشحن: ${JSON.stringify(alloc)}`);

    // السلّةُ المُتمّة لا تُتمّ ثانية
    const again = await runCheckout(container, cartA);
    (again.body as any)?.error?.code === "CART_COMPLETED"
      ? pass("السلّةُ المُتمّة لا تُتمّ ثانيةً")
      : fail(`المتوقّع CART_COMPLETED: ${JSON.stringify(again.body)}`);

    await setPrice(BASE_PRICE);

    // ── ٣) التكرار: ضغطتان ⇒ طلبٌ واحد ──────────────────────────
    logger.info("== التكرار: مفتاحٌ واحدٌ ⇒ طلبٌ واحد ==");

    const cartB = await newCart(1);
    createdCarts.push(cartB);
    await runQuote(container, cartB);

    const key = `gate-${Date.now()}`;
    const before2 = await countOrders();
    const [r1, r2] = await Promise.all([
      runCheckout(container, cartB, key),
      runCheckout(container, cartB, key),
    ]);
    const after2 = await countOrders();

    after2 - before2 === 1
      ? pass("ضغطتان متزامنتان بنفس المفتاح ⇒ **طلبٌ واحد**")
      : fail(`أُنشئ ${after2 - before2} طلباً — والمتوقّع واحد`);

    const ids = [r1, r2]
      .map((r) => (r.body as any)?.order?.id)
      .filter(Boolean);
    const replayed = [r1, r2].some((r) => (r.body as any)?.replayed);
    const inProgress = [r1, r2].some(
      (r) => (r.body as any)?.error?.code === "CHECKOUT_IN_PROGRESS"
    );
    ids.length && (replayed || inProgress)
      ? pass(
          replayed
            ? "والثانيةُ أُعيدت من السجلّ (replayed) لا نُفِّذت"
            : "والثانيةُ رُدّت بـCHECKOUT_IN_PROGRESS ما دامت الأولى تعمل"
        )
      : fail(`ردّا التكرار: ${JSON.stringify([r1.body, r2.body])}`);

    // وبعد انتهاء الأولى: نفسُ المفتاح يُعيد نفسَ الطلب
    const replay = await runCheckout(container, cartB, key);
    (replay.body as any)?.replayed && (replay.body as any)?.order?.id === ids[0]
      ? pass("وإعادةُ المفتاح لاحقاً تُعيد **نفسَ الطلب** لا طلباً ثانياً")
      : fail(`الإعادة: ${JSON.stringify(replay.body)}`);

    // ── ٤) نفادُ المخزون ────────────────────────────────────────
    logger.info("== نفادُ المخزون ⇒ يُرفض قبل أخذ المال ==");

    const cartC = await newCart(2);
    createdCarts.push(cartC);
    await runQuote(container, cartC);

    const itemId = await invItemId();
    const levels = await inventoryModule.listInventoryLevels({ inventory_item_id: itemId });
    const saved = (levels as any[]).map((l) => ({
      inventory_item_id: l.inventory_item_id,
      location_id: l.location_id,
      stocked_quantity: Number(l.stocked_quantity),
    }));

    for (const l of saved) {
      await inventoryModule.updateInventoryLevels([{ ...l, stocked_quantity: 0 }]);
    }

    const before3 = await countOrders();
    const oos = await runCheckout(container, cartC);
    const after3 = await countOrders();

    (oos.body as any)?.error?.code === "OUT_OF_STOCK" && oos.status === 409
      ? pass("نفد المخزون ⇒ OUT_OF_STOCK بـ409")
      : fail(`المتوقّع OUT_OF_STOCK: ${JSON.stringify(oos.body)}`);

    after3 === before3
      ? pass("**ولم يُنشأ طلب**")
      : fail(`أُنشئ طلبٌ رغم النفاد: ${before3} ⇒ ${after3}`);

    const shortLine = (oos.body as any)?.error?.details?.lines?.[0];
    shortLine?.short_by === 2 && !("location_id" in (shortLine ?? {}))
      ? pass("والنقصُ معروضٌ بالصنف (٢) بلا كشفِ مستودعٍ للعميل")
      : fail(`تفصيلُ النقص: ${JSON.stringify(shortLine)}`);

    for (const l of saved) {
      await inventoryModule.updateInventoryLevels([l]);
    }

    // ── ٥) توازنُ المجاميع على طلبٍ حقيقيّ ──────────────────────
    logger.info("== توازنُ المجاميع على الطلبات المُنشأة ==");

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "item_total", "shipping_total", "tax_total", "discount_total"],
    });

    const unbalanced = (orders as any[]).filter((o) => {
      const t = {
        currency_code: "sar",
        item_total: Number(o.item_total ?? 0),
        shipping_total: Number(o.shipping_total ?? 0),
        tax_total: Number(o.tax_total ?? 0),
        discount_total: Number(o.discount_total ?? 0),
        total: Number(o.total ?? 0),
      };
      return !totalsBalance(t).ok;
    });

    unbalanced.length === 0
      ? pass(`كلُّ الطلبات توازن (${(orders as any[]).length} طلباً)`)
      : fail(
          `${unbalanced.length} طلباً لا يوازن — أوّلُها ${unbalanced[0].id}`
        );

    // ── ٦) قيدُ القاعدة على مجاميع الطلب ────────────────────────
    logger.info("== حارسُ القاعدة على order_summary ==");

    const anyOrder = (orders as any[])[0];
    if (anyOrder) {
      try {
        await pg.raw(
          `update "zadim"."order_summary"
              set "totals" = jsonb_set("totals", '{refunded_total}', '999999999')
            where "order_id" = ?`,
          [anyOrder.id]
        );
        fail("استردادٌ يتجاوز المحصَّل مُرِّر — القيد لا يعمل");
      } catch {
        pass("استردادٌ يتجاوز المحصَّل يُرفض في القاعدة");
      }

      try {
        await pg.raw(
          `update "zadim"."order_summary"
              set "totals" = jsonb_set("totals", '{current_order_total}', '-1')
            where "order_id" = ?`,
          [anyOrder.id]
        );
        fail("مجموعٌ سالبٌ مُرِّر");
      } catch {
        pass("مجموعٌ سالبٌ يُرفض في القاعدة");
      }
    }
  } finally {
    await setPrice(BASE_PRICE);
    // السلالُ المُتمّة تصير طلباتٍ ولا تُحذف: حذفُ طلبٍ اختباريٍّ من
    // جدولٍ حقيقيٍّ يُفسد عدّاداتٍ لا نملكها. والسلالُ غيرُ المُتمّة
    // تُحذف لأنها لا تعني شيئاً.
    for (const id of createdCarts) {
      await pg("zadim.cart").where({ id }).whereNull("completed_at").del();
    }
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الإتمام.`);
  logger.info("✅ كلُّ فحوص المرحلة ٤ اجتازت — الرفضُ قبل أخذ المال، مُثبَتاً بعدّ الطلبات.");
}
