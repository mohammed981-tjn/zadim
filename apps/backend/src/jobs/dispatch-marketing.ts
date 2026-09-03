import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ORDERS_MODULE } from "../modules/orders";
import type OrdersModuleService from "../modules/orders/service";
import { MARKETING_MODULE } from "../modules/marketing";
import type MarketingModuleService from "../modules/marketing/service";
import { WISHLIST_MODULE } from "../modules/wishlist";
import type WishlistModuleService from "../modules/wishlist/service";

/**
 * تصريفُ صندوق الأحداث إلى رسائل — **الطرفُ الذي كان ناقصاً**.
 *
 * ── ما كان يقع قبل هذا الملفّ ────────────────────────────────────
 *
 * مُطلِقُ `zadim_emit_price_drop_trg` يكتب حدثاً مع كلّ خفضِ سعر،
 * وحدثُ السلّة المتروكة يُكتب مؤجَّلاً في نفس معاملة الفعل. والصندوقُ
 * يمتلئ — **ولا قارئَ له**: `marketing.dispatch()` لم يكن يناديها إلا
 * سكربتُ البوّابة، ولا مجلَّدَ `jobs/` في المشروع أصلاً. فالجدولُ ينمو
 * بلا سقف، ولا رسالةَ تصل عميلاً واحداً.
 *
 * ── ولماذا مهمّةٌ مجدولةٌ لا مشترِكٌ على الحدث ────────────────────
 *
 * لأن نصفَ هذه الأحداث **مؤجَّلٌ بطبعه**: «تُركت السلّة» ليست فعلاً
 * يقع بل غيابَ فعلٍ يستحقّ بعد مدّة. ومشترِكٌ يُنادى لحظةَ الكتابة لا
 * يستطيع انتظارَ استحقاقها. والقارئُ الدوريُّ يقرأ **ما استحقّ**
 * (`occurred_at <= now`) بفهرسٍ على الوقت — لا يمسح الجداول ولا يكبر
 * عبؤه بحجم المتجر.
 *
 * ── والحدُّ ليس تجميلاً ──────────────────────────────────────────
 *
 * `BATCH` يمنع تشغيلةً تحاول تصريفَ مئة ألفِ حدثٍ متراكمٍ في دورةٍ
 * واحدة فتموت في منتصفها ولا تُسلّم شيئاً. والمتراكمُ يُصرَّف على
 * دوراتٍ، وكلُّ حدثٍ يُوسَم فور تسليمه فلا يُعاد.
 *
 * ⚠️ **ولا مزوّدَ رسائل حقيقيّ بعد** (ينتظر حساب SMS/بريد): `dispatch`
 * بلا دالّةِ إرسالٍ يُخطّط ويحجز ويترك الحالةَ `queued`. فهذه المهمّةُ
 * اليوم تُفرغ الصندوقَ إلى طابورٍ مقروء، ولا تدّعي إرسالاً لم يقع —
 * ويوم يصل المزوّد يُمرَّر هنا ولا يتغيّر شيءٌ آخر.
 */

/** كم حدثاً في الدورة الواحدة. */
const BATCH = 100;

/**
 * 🔴 **من ينتظر رخصَ هذا السعر** — الطرفُ الذي أتمّ بند ٢٢.
 *
 * ── ما كان يقع ──────────────────────────────────────────────────
 *
 * حمولةُ `PriceDropped` تحمل `price_id` و`price_set_id` **ولا تحمل
 * مستقبِلاً**: المُطلِقُ في القاعدة لا يعرف من يهتمّ. فكان `dispatch`
 * يُنادى بـ`recipient = null` **فيُخطِّط صفرَ رسالة** — الحدثُ يُكتب
 * منذ المرحلة ١١، ويُقرأ، ويُوسَم مُسلَّماً، **ولا يصل أحداً**.
 *
 * وهو عطبٌ لا يشكو منه شيء: الصندوقُ يُفرَغ والعدّاداتُ خضراء.
 *
 * ── والسلسلةُ التي تُبنى هنا ────────────────────────────────────
 *
 * `price` ⇐ `price_set` ⇐ `product_variant_price_set` ⇐ `variant`
 * ⇐ `product` ⇐ **صفوفُ المفضّلة** ⇐ بريدُ كلّ عميلٍ منها.
 *
 * ⚠️ **ويُفرَّق بين متغيّرٍ ومتغيّر**: من وضع المقاسَ L في مفضّلته لا
 * يريد خبراً عن رخص المقاس XS. و`variant_id = null` في الصفّ تعني
 * «المنتجَ كلَّه» فيُنبَّه لأيّها.
 */
async function priceDropRecipients(
  container: MedusaContainer,
  payload: Record<string, unknown>
): Promise<Array<{ email: string | null; phone: string | null; locale: string }>> {
  const priceSetId = payload.price_set_id ? String(payload.price_set_id) : "";
  if (!priceSetId) return [];

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const wishlist = container.resolve(WISHLIST_MODULE) as WishlistModuleService;

  // مجموعةُ الأسعار ⇐ المتغيّر ⇐ المنتج.
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product_id"],
    filters: { price_set: { id: priceSetId } },
  });

  const pairs = (variants as any[])
    .map((v) => ({ variant_id: v.id as string, product_id: v.product_id as string }))
    .filter((p) => p.product_id);
  if (!pairs.length) return [];

  const customerIds = new Set<string>();
  for (const pair of pairs) {
    const watchers = await wishlist.watchersOf(pair.product_id, pair.variant_id);
    for (const w of watchers as any[]) customerIds.add(w.customer_id);
  }
  if (!customerIds.size) return [];

  // بريدُ العملاء **الآن** لا من الحمولة: الحمولةُ حدثُ سعرٍ لا حدثُ
  // عميل، ولا بريدَ فيها أصلاً. وهذا الاستثناءُ الوحيدُ من قاعدة
  // «المستقبِلُ من الحمولة» — ومقصودٌ: المشترِكُ قد يكون اشترك اليوم.
  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "email", "phone"],
    filters: { id: [...customerIds] },
  });

  return (customers as any[])
    .filter((c) => c.email || c.phone)
    .map((c) => ({ email: c.email ?? null, phone: c.phone ?? null, locale: "ar" }));
}

export default async function dispatchMarketing(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const orders = container.resolve(ORDERS_MODULE) as OrdersModuleService;
  const marketing = container.resolve(MARKETING_MODULE) as MarketingModuleService;

  const pending = (await orders.pendingEvents(BATCH)) as any[];
  if (!pending.length) return;

  let planned = 0;
  let claimed = 0;
  let failed = 0;

  for (const row of pending) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    // المستقبِلُ من حمولة الحدث لا من قراءةٍ ثانية: الحمولةُ كُتبت
    // لحظةَ الفعل، وبريدُ العميل يومَها هو الذي يخصّ هذا الحدث. وقراءتُه
    // اليوم تُرسل إلى عنوانٍ غيّره بعد الواقعة.
    const recipient = {
      email: (payload.email as string) ?? null,
      phone: (payload.phone as string) ?? null,
      locale: (payload.locale as string) ?? "ar",
    };

    try {
      const due = {
        id: row.id,
        event: row.event,
        aggregate_type: row.aggregate_type,
        aggregate_id: row.aggregate_id,
        payload: row.payload ?? null,
        occurred_at: new Date(row.occurred_at),
        attempts: Number(row.attempts) || 0,
      };

      // حدثٌ واحدٌ ⇐ مستقبِلون كُثر (بند ٢٢). وحارسُ التكرار في
      // `claimSend` مفتاحُه (الحدث · القناة · المستقبِل)، فالتوزيعُ على
      // عشرةٍ عشرةُ حجوزاتٍ متمايزة — ولا يُرسل لأحدهم مرّتين لو أُعيدت
      // الدورةُ بعد سقوطٍ في منتصفها.
      const targets =
        row.event === "PriceDropped"
          ? await priceDropRecipients(container, payload)
          : recipient.email || recipient.phone
            ? [recipient]
            : [];

      for (const target of targets.length ? targets : [null]) {
        const out = await marketing.dispatch(due, target);
        planned += out.planned;
        claimed += out.claimed;
      }

      // 🔴 يُوسَم مُسلَّماً **بعد** الحجز لا قبله: حدثٌ يُوسَم ثم يسقط
      // الحجزُ يضيع بلا أثر، ولا شيءَ يُعيده — الصندوقُ لا يُقرأ إلا
      // غيرَ المُسلَّم.
      await orders.markDelivered(row.id);
    } catch (e) {
      failed++;
      // ولا يُوسَم: يُعاد في الدورة القادمة. و`attempts` يعدّ المحاولات
      // كي يظهر الحدثُ الذي يفشل دائماً بدل أن يُعاد إلى الأبد صامتاً.
      await orders.markFailed(row.id, String((e as Error).message), Number(row.attempts) || 0);
      logger.error(`[zadim] تعذّر تصريفُ الحدث ${row.id} (${row.event}): ${(e as Error).message}`);
    }
  }

  logger.info(
    `[zadim] تصريفُ التسويق: ${pending.length} حدثاً · ${planned} خطّةً · ${claimed} حجزاً · ${failed} فشلاً.`
  );
}

export const config = {
  name: "dispatch-marketing",
  // كلَّ خمس دقائق: «السلّةُ المتروكة» تُقاس بالساعات، فدقّةُ الدقيقة
  // لا تشتري شيئاً وتُضاعف نداءات القاعدة على خطّةٍ مجانيةٍ لها سقف.
  schedule: "*/5 * * * *",
};
