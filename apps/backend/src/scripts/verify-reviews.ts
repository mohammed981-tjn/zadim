import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { REVIEWS_MODULE } from "../modules/reviews";
import type ReviewsModuleService from "../modules/reviews/service";

/**
 * بوّابةُ التقييمات (بند ٢٣) — **«يشترط الشراء: قيدٌ لا فحصُ واجهة»**.
 *
 * 🔴 **وتُنادي الوحدةَ مباشرةً لا المسار.** ومقصود: المسارُ يفحص
 * المدخلاتِ ويترجم الرفض، والسؤالُ هنا **هل يمنع القيدُ من يتخطّى
 * المسار؟** فلو فُحص عبره لكان الجوابُ عن حارسٍ آخر.
 *
 * وثلاثةُ شواهدَ سالبةٍ لا واحد — لأن المفتاحَ الأجنبيَّ في مخطَّط
 * المرحلة ٠ يجيب أوّلَها وحدَه:
 *
 * ١. سطرٌ لا وجودَ له ⇒ يُرفض.
 * ٢. سطرُ **عميلٍ آخر** ⇒ يُرفض (وإلا كتب من يعرف معرّفَه تقييماً باسمه).
 * ٣. سطرٌ لمنتجٍ **آخر** ⇒ يُرفض (وإلا قيّم من اشترى قميصاً هاتفاً).
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-reviews.ts
 */
export default async function verifyReviews({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const reviews = container.resolve(REVIEWS_MODULE) as ReviewsModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `rev-${Date.now()}`;
  const madeIds: string[] = [];

  /** يحاول الكتابةَ ويُعيد `true` إن رُفضت. */
  const refused = async (input: Record<string, unknown>): Promise<boolean> => {
    try {
      const r = await reviews.createReviews(input as any);
      const id = (r as any)?.id;
      if (id) madeIds.push(id);
      return false;
    } catch {
      return true;
    }
  };

  try {
    logger.info("== التقييمُ يشترط الشراء — قيدٌ لا فحصُ واجهة ==");

    // سطرُ طلبٍ حقيقيٌّ من البذرة، ومعه صاحبُه ومنتجُه.
    const rows = await pg.raw(
      `select li."id" as line_id, li."product_id", o."customer_id", o."id" as order_id
         from "order_line_item" li
         join "order_item" oi on oi."item_id" = li."id"
         join "order" o on o."id" = oi."order_id"
        where li."deleted_at" is null and o."customer_id" is not null
          and li."product_id" is not null
        limit 1`
    );
    const bought = rows?.rows?.[0];
    if (!bought) {
      fail("لا سطرَ طلبٍ بعميلٍ ومنتج — شغّل البذور وبوّابة الطلبات أوّلاً");
      process.exit(1);
    }

    // ── ١) الشاهدُ الموجب: من اشترى **يستطيع** ──────────────────
    const ok = await reviews.createReviews({
      product_id: bought.product_id,
      customer_id: bought.customer_id,
      order_line_item_id: bought.line_id,
      rating: 5,
      body: `بوّابة ${tag}`,
    } as any);
    const okId = (ok as any)?.id;
    if (okId) madeIds.push(okId);
    okId
      ? pass("من اشترى يستطيع التقييم — والحارسُ يمنع الحالةَ وحدَها لا الجميع")
      : fail("مشترٍ حقيقيٌّ مُنع من التقييم");

    // ── ٢) الشواهدُ السالبةُ الثلاثة ────────────────────────────
    (await refused({
      product_id: bought.product_id,
      customer_id: bought.customer_id,
      order_line_item_id: `oli_does_not_exist_${tag}`,
      rating: 5,
    }))
      ? pass("① سطرُ طلبٍ لا وجودَ له ⇒ يُرفض")
      : fail("قُبل تقييمٌ بسطرِ طلبٍ مخترَع — «لا تقييمَ بلا شراء» غيرُ مفروض");

    (await refused({
      product_id: bought.product_id,
      customer_id: `cus_someone_else_${tag}`,
      order_line_item_id: bought.line_id,
      rating: 5,
    }))
      ? pass("② سطرُ **عميلٍ آخر** ⇒ يُرفض — ولولاه لكتب من يعرف معرّفَه تقييماً باسمه")
      : fail("قُبل تقييمٌ على شراء غيره — وهو ما لا يمنعه مفتاحٌ أجنبيّ");

    (await refused({
      product_id: `prod_other_${tag}`,
      customer_id: bought.customer_id,
      order_line_item_id: bought.line_id,
      rating: 5,
    }))
      ? pass("③ سطرٌ لمنتجٍ **آخر** ⇒ يُرفض — ولولاه لقيّم من اشترى قميصاً هاتفاً")
      : fail("قُبل تقييمُ منتجٍ لم يُشترَ بهذا السطر");

    // ── ٣) تقييمٌ واحدٌ لكل شراء ────────────────────────────────
    (await refused({
      product_id: bought.product_id,
      customer_id: bought.customer_id,
      order_line_item_id: bought.line_id,
      rating: 1,
    }))
      ? pass("وتقييمٌ ثانٍ لنفس الشراء يُرفض — وإلا صوّت الواحدُ مرّاتٍ على منتجٍ واحد")
      : fail("قُبل تقييمان لنفس سطر الطلب");

    // ── ٤) المدى ────────────────────────────────────────────────
    (await refused({
      product_id: bought.product_id,
      customer_id: `cus_range_${tag}`,
      order_line_item_id: bought.line_id,
      rating: 6,
    }))
      ? pass("وتقييمٌ خارجَ ١–٥ يُرفض")
      : fail("قُبل تقييمٌ خارج المدى");

    // ── ٥) 🔴 والمعلَّقُ لا يُعرض ────────────────────────────────
    logger.info("== والنشرُ بعد المراجعة ==");

    const published = (await reviews.publishedFor(bought.product_id)) as any[];
    !published.some((r) => r.id === okId)
      ? pass("تقييمٌ جديدٌ **لا يُعرض** — يبدأ `pending`، فلا تصير صفحةُ المنتج لوحةَ إعلانات")
      : fail("تقييمٌ غيرُ مراجَعٍ ظهر للزوّار");

    let summary = await reviews.summaryFor(bought.product_id);
    const countBefore = summary.count;

    await reviews.updateReviews({ id: okId, status: "published" } as any);

    const after = (await reviews.publishedFor(bought.product_id)) as any[];
    after.some((r) => r.id === okId)
      ? pass("وبعد النشر يُعرض")
      : fail("التقييمُ المنشورُ لا يظهر");

    summary = await reviews.summaryFor(bought.product_id);
    summary.count === countBefore + 1 && summary.average !== null
      ? pass(`والمتوسّطُ يُحسب عند القراءة (${summary.average} من ${summary.count})`)
      : fail(`الملخّص: ${JSON.stringify(summary)}`);

    // والمرفوضُ يخرج من الحساب.
    await reviews.updateReviews({ id: okId, status: "rejected" } as any);
    (await reviews.summaryFor(bought.product_id)).count === countBefore
      ? pass("والمرفوضُ يخرج من المتوسّط فوراً — لأنه يُحسب لا يُخزَّن")
      : fail("المرفوضُ بقي في المتوسّط — عمودٌ محدَّثٌ يفترق عن مصدره");
  } finally {
    if (madeIds.length) {
      await pg.raw(`delete from "zadim_review" where "id" = any(?)`, [madeIds]);
    }
    await pg.raw(`delete from "zadim_review" where "body" like ?`, [`%${tag}%`]);
  }

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ التقييمات اجتازت.");
}
