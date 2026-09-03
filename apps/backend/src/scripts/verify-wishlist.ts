import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { WISHLIST_MODULE } from "../modules/wishlist";
import type WishlistModuleService from "../modules/wishlist/service";
import { ORDERS_MODULE } from "../modules/orders";
import type OrdersModuleService from "../modules/orders/service";

/**
 * بوّابةُ المفضّلة (بند ٢٢) — **«المفضّلة تعرف انخفاض السعر»**.
 *
 * 🔴 **وأهمُّ ما تحرسه ليس الجدولَ بل الوصلة.** قائمةٌ تُحفظ وتُقرأ
 * تُرضي نصفَ نصِّ البند؛ والنصفُ الذي يهمّ أن **يصل الخبرُ** حين يرخص
 * السعر. وقبل هذه الدفعة كان حدثُ `PriceDropped` يُكتب ويُقرأ ويُوسَم
 * مُسلَّماً **ولا يصل أحداً** — لأن حمولتَه بلا مستقبِل. وهو عطبٌ لا
 * يشكو منه شيء: الصندوقُ يُفرَغ والعدّاداتُ خضراء.
 *
 * فتفحص هذه البوّابةُ **السلسلةَ كاملةً على القاعدة**:
 * سعرٌ يُخفَّض ⇒ حدثٌ يُكتب ⇒ المتغيّرُ يُستدلّ عليه من مجموعة الأسعار
 * ⇒ المنتجُ ⇒ صفوفُ المفضّلة ⇒ عميلٌ بعينه.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-wishlist.ts
 */
export default async function verifyWishlist({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const wishlist = container.resolve(WISHLIST_MODULE) as WishlistModuleService;
  const orders = container.resolve(ORDERS_MODULE) as OrdersModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `wish-${Date.now()}`;
  const customerA = `cus_${tag}_a`;
  const customerB = `cus_${tag}_b`;
  const made: string[] = [];

  try {
    // ── ١) القائمة ─────────────────────────────────────────────
    logger.info("== المفضّلة: الحفظُ والقراءة ==");

    // 🔴 **متغيّرٌ له سعرٌ فعلاً** لا أوّلُ متغيّرٍ يُصادَف.
    //
    // أوّلُ كتابةٍ لهذه البوّابة أخذت أوّلَ منتجٍ له متغيّرات، فوقعت على
    // منتجات `seed-catalog` — ولها متغيّراتٌ **بلا أسعار** (تُنشأ لحمل
    // الخصائص لا للبيع). فسقطت البوّابةُ بـ«لا سعرَ لهذا المتغيّر»،
    // وهو سقوطٌ في الفحص لا في النظام. والاختيارُ الآن من الأسعار
    // نفسِها إلى أعلى.
    const seedRows = await pg.raw(
      `select l."variant_id", v."product_id"
         from "price" p
         join "product_variant_price_set" l on l."price_set_id" = p."price_set_id"
         join "product_variant" v on v."id" = l."variant_id"
        where p."deleted_at" is null and v."deleted_at" is null
        limit 1`
    );
    const seed = seedRows?.rows?.[0];
    if (!seed) {
      fail("لا متغيّرَ بسعر — شغّل seed-commerce");
      process.exit(1);
    }
    const variantId = seed.variant_id as string;
    const product = { id: seed.product_id as string };

    const first = await wishlist.add({ customer_id: customerA, product_id: product.id });
    made.push((first.item as any).id);
    first.created ? pass("صنفٌ يُضاف") : fail("الإضافةُ لم تُنشئ صفّاً");

    // 🔴 المتماثلةُ عند الإعادة: ضغطتان صفٌّ واحد.
    const again = await wishlist.add({ customer_id: customerA, product_id: product.id });
    !again.created && (again.item as any).id === (first.item as any).id
      ? pass("وضغطةٌ ثانيةٌ لا تُنشئ صفّاً ثانياً — ولا تُردّ بخطأ")
      : fail("الإضافةُ المكرّرة أنشأت صفّاً — وأثرُه خبران عن خفضٍ واحد");

    ((await wishlist.listFor(customerA)) as any[]).length === 1
      ? pass("والقائمةُ صفٌّ واحد")
      : fail("القائمةُ فيها أكثرُ من صفّ");

    // ولا يرى أحدُهما مفضّلةَ الآخر.
    ((await wishlist.listFor(customerB)) as any[]).length === 0
      ? pass("وعميلٌ آخرُ لا يرى شيئاً — القائمةُ مقيَّدةٌ بصاحبها")
      : fail("عميلٌ رأى مفضّلةَ غيره");

    // ── ٢) 🔴 السلسلةُ إلى انخفاض السعر ─────────────────────────
    logger.info("== وتعرف انخفاضَ السعر ==");

    // سعرُ هذا المتغيّر ومجموعتُه.
    const priceRows = await pg.raw(
      `select p."id", p."amount", p."price_set_id"
         from "price" p
         join "product_variant_price_set" l on l."price_set_id" = p."price_set_id"
        where l."variant_id" = ? and p."deleted_at" is null
        limit 1`,
      [variantId]
    );
    const price = priceRows?.rows?.[0];
    if (!price) {
      fail("لا سعرَ لهذا المتغيّر — شغّل seed-commerce");
    } else {
      // الوصلةُ العكسية: من مجموعة الأسعار إلى المتغيّر ثم المنتج.
      // وهي بالضبط ما تفعله `priceDropRecipients`.
      const { data: back } = await query.graph({
        entity: "product_variant",
        fields: ["id", "product_id"],
        filters: { price_set: { id: price.price_set_id } },
      });
      const found = (back as any[]).find((v) => v.id === variantId);
      found?.product_id === product.id
        ? pass("مجموعةُ الأسعار تُرجِع إلى المتغيّر ثم المنتج — والسلسلةُ متّصلة")
        : fail(
            `السلسلةُ مقطوعة: price_set ⇐ variant أعطت ${JSON.stringify(back)} — ` +
              "وبلا هذه الوصلة لا يُعرف من يهتمّ بالخفض"
          );

      // ومن ينتظر؟
      const watchers = (await wishlist.watchersOf(product.id, variantId)) as any[];
      watchers.some((w) => w.customer_id === customerA)
        ? pass("ومن وضعه في مفضّلته يُعدّ منتظِراً")
        : fail("صاحبُ المفضّلة لم يُعدّ منتظِراً للخفض");

      // 🔴 وشاهدٌ سالب: من اختار متغيّراً بعينه لا يُنبَّه لغيره.
      const other = `${variantId}_not_this_one`;
      await wishlist.add({
        customer_id: customerB,
        product_id: product.id,
        variant_id: other,
      });
      const narrowed = (await wishlist.watchersOf(product.id, variantId)) as any[];
      !narrowed.some((w) => w.customer_id === customerB)
        ? pass("ومن اختار متغيّراً آخرَ **لا** يُنبَّه — فمن أراد المقاسَ L لا يريد خبراً عن XS")
        : fail("منتظِرُ متغيّرٍ آخرَ أُدرج في قائمة الخفض");

      // وصاحبُ `variant_id = null` يُنبَّه لأيّ متغيّر.
      const anyVariant = (await wishlist.watchersOf(product.id, other)) as any[];
      anyVariant.some((w) => w.customer_id === customerA)
        ? pass("ومن لم يختر متغيّراً يُنبَّه لأيّها")
        : fail("صاحبُ «المنتج كلّه» لم يُنبَّه لمتغيّرٍ منه");

      // ── ٣) والحدثُ يُكتب فعلاً عند الخفض لا عند الرفع ─────────
      const countDrops = async () => {
        const r = await pg.raw(
          `select count(*)::int as n from "zadim_outbox_event"
            where "event" = 'PriceDropped' and "aggregate_id" = ?`,
          [price.id]
        );
        return Number(r?.rows?.[0]?.n ?? 0);
      };

      const before = await countDrops();
      const original = Number(price.amount);
      await pg.raw(`update "price" set "amount" = ? where "id" = ?`, [original + 500, price.id]);
      (await countDrops()) === before
        ? pass("ورفعُ السعر لا يكتب حدثاً — العميلُ يريد أن يعلم حين يرخص لا حين يغلو")
        : fail("رفعُ السعر كتب حدثَ خفض");

      await pg.raw(`update "price" set "amount" = ? where "id" = ?`, [original - 500, price.id]);
      const after = await countDrops();
      after > before
        ? pass(`وخفضُه يكتب حدثاً (${before} ⇐ ${after})`)
        : fail("خفضُ السعر لم يكتب حدثاً");

      await pg.raw(`update "price" set "amount" = ? where "id" = ?`, [original, price.id]);

      // ── ٤) 🔴 والحمولةُ تحمل ما يكفي لبناء القائمة ────────────
      const payloadRow = await pg.raw(
        `select "payload" from "zadim_outbox_event"
          where "event" = 'PriceDropped' and "aggregate_id" = ?
          order by "occurred_at" desc limit 1`,
        [price.id]
      );
      const payload = payloadRow?.rows?.[0]?.payload ?? {};
      payload?.price_set_id === price.price_set_id
        ? pass("والحمولةُ تحمل `price_set_id` — وهو المفتاحُ الوحيدُ إلى المنتج، فبدونه لا مستقبِلَ يُعرف")
        : fail(`الحمولةُ بلا price_set_id: ${JSON.stringify(payload)}`);

      // ونظّفْ ما كُتب كي لا تتراكم أحداثُ البوّابة.
      await pg.raw(
        `delete from "zadim_outbox_event" where "event" = 'PriceDropped' and "aggregate_id" = ?`,
        [price.id]
      );
      void orders;
    }
  } finally {
    await pg.raw(`delete from "zadim_wishlist_item" where "customer_id" like ?`, [`cus_${tag}%`]);
  }

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ المفضّلة اجتازت.");
}
