import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../modules/catalog";
import type CatalogModuleService from "../modules/catalog/service";
import { isReadPath } from "../modules/catalog/overlay";

/**
 * بوّابةُ المرحلة ١١ب — المتجرُ بلغتين، **جانبُ القاعدة**.
 *
 * > المحتوى الذي يملكه المديرُ يُترجَم كبيانات، وما لا ترجمةَ له يظهر
 * > بأصله، وما لا يجوز ترجمتُه لا يُترجَم.
 *
 * ── وما لا يفحصه هذا الملفّ ─────────────────────────────────────
 *
 * لا يفتح متصفّحاً ولا يقرأ صفحة. اتجاهُ الصفحة، وغيابُ العربية من
 * `/en`، والمفاتيحُ الخام، ودرجةُ Lighthouse — كلُّها في
 * `scripts/verify-ui.mjs`. وخضرةُ هذا الملفّ **لا تعني أن `/en`
 * إنجليزية**، بل أن القاعدةَ تُعطي الإنجليزيةَ لمن يطلبها.
 *
 * ── ولماذا يقيس أثرَ الإلباس لا وجودَ الجدول ────────────────────
 *
 * جدولٌ فيه صفوفُ ترجمةٍ لا يُثبت شيئاً: قد يكون الوسيطُ غيرَ مركَّب،
 * أو مركَّباً على مسارٍ لا يمرّ به أحد. فالمقياسُ هنا **الدالّةُ التي
 * يناديها الوسيط** (`translationsFor`) مطبَّقةً على شكلِ ردٍّ حقيقيّ.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-i18n.ts
 */

/** نسخةٌ من مشيِ الوسيط — تُستدعى على ردٍّ مصطنَعٍ بنفس شكل ردّ Medusa. */
function applyOverlay(node: any, byEntity: Record<string, Record<string, string>>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) applyOverlay(item, byEntity);
    return;
  }
  if (typeof node.id === "string" && byEntity[node.id]) {
    for (const [field, value] of Object.entries(byEntity[node.id])) {
      if (field in node) node[field] = value;
    }
  }
  for (const key of Object.keys(node)) applyOverlay(node[key], byEntity);
}

const ARABIC = /[؀-ۿ]/;

export default async function verifyI18n({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const catalog = container.resolve(CATALOG_MODULE) as CatalogModuleService;
  const productModule = container.resolve(Modules.PRODUCT);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const made: string[] = [];

  try {
    /* ── ١) الحقلُ المسموح — والقائمةُ في القاعدة ─────────────── */
    logger.info("== ما يجوز ترجمته ==");

    const [shirt] = await productModule.listProducts(
      { handle: "cotton-shirt" },
      { select: ["id", "title", "handle"] }
    );
    if (!shirt) {
      fail("منتجُ القياس «cotton-shirt» غيرُ مبذور — شغّل seed-catalog أولاً");
      throw new Error("no fixture");
    }

    // 🔴 الشاهدُ الموجب للقيد: لولاه لكان «لم يُرفض شيء» جوابَ حارسٍ
    // معطَّلٍ وجوابَ حارسٍ سليمٍ سواءً بسواء.
    for (const bad of [
      { field: "handle", why: "الرابطُ يُكسر بالترجمة" },
      { field: "status", why: "حالةُ النشر ليست نصّاً للعرض" },
      { field: "thumbnail", why: "مسارُ صورةٍ لا جملة" },
    ]) {
      let rejected = false;
      try {
        await pg.raw(
          `insert into zadim_translation (id, entity_type, entity_id, field, locale, value)
           values (?, 'product', ?, ?, 'en', 'x')`,
          [`trn_gate_${bad.field}`, shirt.id, bad.field]
        );
      } catch {
        rejected = true;
      }
      rejected
        ? pass(`«${bad.field}» مرفوضٌ في القاعدة — ${bad.why}`)
        : fail(`«${bad.field}» قُبل! والقيدُ لا يحرس`);
      if (!rejected) {
        await pg.raw(`delete from zadim_translation where id = ?`, [`trn_gate_${bad.field}`]);
      }
    }

    // وشاهدُ القبول: القيدُ يرفض ما لا يجوز **ولا يرفض كلَّ شيء**.
    let allowed = true;
    try {
      const row = await catalog.setTranslation({
        entity_type: "product",
        entity_id: shirt.id,
        field: "subtitle",
        locale: "en",
        value: "Gate fixture subtitle",
      });
      made.push((row as any).id);
    } catch (err) {
      allowed = false;
      fail(`«subtitle» رُفض وهو مسموح: ${(err as Error).message}`);
    }
    if (allowed) pass("«subtitle» قُبل — القيدُ يفصل ولا يقفل الباب كلَّه");

    /* ── ٢) القيمةُ الفارغة واللغةُ الفاسدة ──────────────────── */
    logger.info("== القيمةُ واللغة ==");

    for (const bad of [
      { field: "title", locale: "en", value: "   ", why: "الفارغةُ تمحو ولا تحلّ" },
      { field: "title", locale: "english", value: "Shirt", why: "رمزُ لغةٍ لا اسمُها" },
    ]) {
      let rejected = false;
      try {
        await pg.raw(
          `insert into zadim_translation (id, entity_type, entity_id, field, locale, value)
           values (?, 'product', ?, ?, ?, ?)`,
          [`trn_gate_v_${bad.locale}`, shirt.id, bad.field, bad.locale, bad.value]
        );
      } catch {
        rejected = true;
      }
      rejected
        ? pass(`«${bad.locale}»/«${bad.value.trim() || "فراغ"}» مرفوض — ${bad.why}`)
        : fail(`قُبل ما لا يجوز: locale=${bad.locale} value=«${bad.value}»`);
      if (!rejected) {
        await pg.raw(`delete from zadim_translation where id = ?`, [
          `trn_gate_v_${bad.locale}`,
        ]);
      }
    }

    /* ── ٣) لا ترجمتان لنفس الحقل ───────────────────────────── */
    logger.info("== التفرّد ==");

    let dupRejected = false;
    try {
      await pg.raw(
        `insert into zadim_translation (id, entity_type, entity_id, field, locale, value)
         values (?, 'product', ?, 'title', 'en', 'Second Title')`,
        [`trn_gate_dup`, shirt.id]
      );
    } catch {
      dupRejected = true;
    }
    dupRejected
      ? pass("ترجمةٌ ثانيةٌ لنفس (منتج · حقل · لغة) مرفوضة — لا عرضٌ يقرّره ترتيبُ الصفوف")
      : fail("قُبلت ترجمةٌ مكرّرة!");
    if (!dupRejected) await pg.raw(`delete from zadim_translation where id = 'trn_gate_dup'`);

    /* ── ٤) 🔴 الإلباس: `/en` يعرض الإنجليزيةَ من القاعدة ────── */
    logger.info("== الإلباس ==");

    // ردٌّ مصطنَعٌ بنفس شكل ردّ `/store/products`: منتجٌ فيه متغيّرٌ
    // فيه تصنيف — فيُقاس المشيُ في العمق لا في السطح.
    const [variant] = await productModule.listProductVariants(
      { product_id: shirt.id },
      { select: ["id", "title"] }
    );
    const [clothing] = await productModule.listProductCategories(
      { handle: "ملابس" },
      { select: ["id", "name"] }
    );

    const body: any = {
      products: [
        {
          id: shirt.id,
          title: shirt.title,
          handle: shirt.handle,
          subtitle: null,
          variants: variant ? [{ id: variant.id, title: variant.title }] : [],
          categories: clothing ? [{ id: clothing.id, name: clothing.name }] : [],
        },
      ],
    };

    const arabicTitle = String(shirt.title);
    ARABIC.test(arabicTitle)
      ? pass(`عنوانُ القياس عربيٌّ في القاعدة: «${arabicTitle}»`)
      : fail(`عنوانُ «cotton-shirt» ليس عربياً (${arabicTitle}) — لا يُثبت الفحصُ شيئاً`);

    const ids = [shirt.id, variant?.id, clothing?.id].filter(Boolean) as string[];
    const en = await catalog.translationsFor(ids, "en");
    applyOverlay(body, en);

    const shown = body.products[0];
    shown.title === "Cotton Shirt"
      ? pass(`العنوانُ بعد الإلباس: «${shown.title}» — من القاعدة لا من الواجهة`)
      : fail(`العنوانُ بعد الإلباس «${shown.title}» ولم يُلبَس`);

    !ARABIC.test(String(shown.title))
      ? pass("ولا حرفَ عربيٍّ فيه")
      : fail("بقيت العربيةُ في العنوان المُلبَس");

    // التصنيفُ في العمق الثاني: إن لم يُترجَم فالمشيُ سطحيّ.
    if (clothing) {
      shown.categories[0].name === "Clothing"
        ? pass("والتصنيفُ المتداخل تُرجم — المشيُ يبلغ العمق")
        : fail(`التصنيفُ المتداخل «${shown.categories[0].name}»`);
    }

    /* ── ٥) وما لا ترجمةَ له يعود بأصله ─────────────────────── */
    logger.info("== الغائب ==");

    const [iphone] = await productModule.listProducts(
      { handle: "iphone-15-pro" },
      { select: ["id", "title"] }
    );
    const noTitle = await catalog.translationsFor([iphone.id], "en");
    const body2: any = { products: [{ id: iphone.id, title: iphone.title }] };
    applyOverlay(body2, noTitle);
    body2.products[0].title === iphone.title
      ? pass(`منتجٌ بلا ترجمةِ عنوانٍ يعود بأصله: «${body2.products[0].title}»`)
      : fail("عنوانٌ بلا ترجمةٍ تغيّر — إمّا فراغٌ وإمّا مفتاحٌ خام");

    // 🔴 وحقلٌ غيرُ مطلوبٍ في الردّ لا يُضاف بترجمته.
    const body3: any = { products: [{ id: shirt.id, handle: shirt.handle }] };
    applyOverlay(body3, en);
    !("title" in body3.products[0])
      ? pass("حقلٌ لم يطلبه المُنادي لا يُضاف — شكلُ الردّ لا يتغيّر بترجمة")
      : fail("أُضيف `title` إلى ردٍّ لم يطلبه");

    /* ── ٦) لغةٌ لا ترجمةَ فيها أصلاً ────────────────────────── */
    const fr = await catalog.translationsFor(ids, "fr");
    Object.keys(fr).length === 0
      ? pass("لغةٌ بلا صفوفٍ تُعيد فراغاً — والأصلُ يُعرض")
      : fail("أعادت لغةٌ غيرُ مبذورةٍ ترجماتٍ!");

    /* ── ٧) 🔴 السجلُّ لا يُترجَم، والعرضُ يُترجَم ─────────────── */
    logger.info("== العرضُ والسجلّ ==");

    // شاهدان في اتجاهين: قائمةٌ تقبل كلَّ شيء تسقط في الأوّل، وقائمةٌ
    // فارغةٌ تسقط في الثاني. ولا تمرّ إلا قائمةٌ تفصل.
    for (const p of [
      "/store/carts/cart_123",
      "/store/orders/order_123",
      "/store/customers/me",
      "/admin/products",
    ]) {
      isReadPath(p)
        ? fail(`مسارُ سجلٍّ سيُترجَم: ${p} — فاتورةٌ صدرت تُعاد كتابتُها`)
        : pass(`لا إلباسَ على ${p}`);
    }
    for (const p of ["/store/products", "/store/products/prod_1", "/store/search"]) {
      isReadPath(p)
        ? pass(`الإلباسُ يشمل ${p}`)
        : fail(`مسارُ عرضٍ لا يُلبَس: ${p} — المتجرُ يبقى عربياً في /en`);
    }

    // ⚠️ وأن الوسيطَ **مركَّبٌ أصلاً**: القائمةُ الصحيحةُ في وسيطٍ لا
    // يُنادى لا تفعل شيئاً. وقِيس أن `matcher` باسمٍ صريحٍ لا يُطابِق.
    const mw = readFileSync(join(process.cwd(), "src/api/middlewares.ts"), "utf8");
    /\{\s*matcher:\s*"\/store\/\*"[^}]*overlayTranslations/.test(mw)
      ? pass("ومركَّبٌ على «/store/*» — الصيغةُ الوحيدةُ التي تُطابِق فعلاً")
      : fail("الوسيطُ غيرُ مركَّبٍ على «/store/*» — لن يُنادى");
  } finally {
    // لا تُترك آثارُ البوّابة في قاعدةٍ باقية: تشغيلةٌ ثانيةٌ تسقط
    // على «موجودٌ أصلاً» فيبدو العطلُ عطلَ كود.
    for (const id of made) {
      await pg.raw(`delete from zadim_translation where id = ?`, [id]).catch(() => {});
    }
    await pg
      .raw(`delete from zadim_translation where id like 'trn_gate_%'`)
      .catch(() => {});
  }

  if (failures) {
    logger.error(`\n⛔ بوّابةُ المرحلة ١١ب (القاعدة): ${failures} فحصاً ساقطاً`);
    process.exit(1);
  }
  logger.info("\n✅ بوّابةُ المرحلة ١١ب (القاعدة): المحتوى يُترجَم كبيانات.");
}
