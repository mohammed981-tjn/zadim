import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../modules/catalog";
import type CatalogModuleService from "../modules/catalog/service";
import { normalizeArabic, expandWithSynonyms } from "../modules/catalog/arabic";

/**
 * بوّابةُ المرحلة ٢ (`07-roadmap.md`).
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-catalog.ts
 * المخرَج: يرمي إن سقط فحصٌ واحد.
 */
export default async function verifyCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const catalog = container.resolve<CatalogModuleService>(CATALOG_MODULE);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => { logger.error(`  ⛔ ${m}`); failures++; };

  // ── ١) التطبيع ─────────────────────────────────────────────────
  logger.info("== تطبيع العربية ==");
  const forms = ["ايفون", "آيفون", "أيفون", "إيفون", "اَيْفون", "ايـفون"];
  const normalized = forms.map(normalizeArabic);
  new Set(normalized).size === 1
    ? pass(`ستّة أشكالٍ ⇒ «${normalized[0]}» واحدة`)
    : fail(`الأشكال لم تتوحّد: ${JSON.stringify(normalized)}`);

  normalizeArabic("سعة ٢٥٦ جيجا") === "سعه 256 جيجا"
    ? pass("الأرقام الهندية ⇒ عربية · التاء المربوطة ⇒ هاء")
    : fail(`تطبيعُ الأرقام أخطأ: «${normalizeArabic("سعة ٢٥٦ جيجا")}»`);

  normalizeArabic("مَطْبُوعَة") === "مطبوعه"
    ? pass("التشكيل يُحذف")
    : fail("التشكيل لم يُحذف");

  // ── ٢) البحث — قلبُ البوّابة ───────────────────────────────────
  logger.info("== البحث: «ايفون» تجد iPhone ==");
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "description"],
  });

  const search = async (q: string) => {
    const terms = await catalog.expandQuery(q);
    return (products as any[]).filter((p) => {
      const hay = normalizeArabic(`${p.title ?? ""} ${p.description ?? ""} ${p.handle ?? ""}`);
      return terms.some((t) => t && hay.includes(t));
    });
  };

  for (const q of ["ايفون", "آيفون", "أيفون", "إيفون"]) {
    const hits = await search(q);
    hits.some((p: any) => p.handle === "iphone-15-pro")
      ? pass(`«${q}» ⇒ تجد iPhone 15 Pro`)
      : fail(`«${q}» لم تجد iPhone — وجدت ${hits.length}`);
  }

  // ── ٣) العكس ───────────────────────────────────────────────────
  const en = await search("iphone");
  en.some((p: any) => p.handle === "iphone-15-pro")
    ? pass("«iphone» بالإنجليزية تجده أيضاً")
    : fail("«iphone» لم تجده");

  // 🔴 اختبارُ انحدارٍ: بحثٌ عن علامةٍ لا يُرجع منافسَها.
  //
  // كانت مطابقةُ المرادفات بالاحتواء، و`"iphone".includes("phone")`
  // صحيحة — فسحبت مجموعةَ «جوال ⇄ phone» وأرجعت **سامسونج مع آيفون**.
  // كشفه فحصٌ حيٌّ بـcurl، والفحصُ الآليّ لم يكن يسأل عن العدد.
  const iphoneOnly = await search("iphone");
  iphoneOnly.length === 1 && iphoneOnly[0].handle === "iphone-15-pro"
    ? pass("«iphone» ⇒ آيفون وحده، لا منافسَه (احتواءٌ ⇒ كلمةٌ كاملة)")
    : fail(`«iphone» أرجعت ${iphoneOnly.length}: ${iphoneOnly.map((p: any) => p.title).join("، ")}`);

  // وفي المقابل «جوال» **يجب** أن تُرجع الاثنين — فالمرادفُ العامّ
  // مقصود، والإصلاحُ لم يقتله.
  const phones = await search("جوال");
  phones.length === 2
    ? pass("«جوال» ⇒ الجوالان معاً (المرادفُ العامّ لم ينكسر)")
    : fail(`«جوال» أرجعت ${phones.length} وكان يجب ٢`);

  // بحثٌ لا ينبغي أن يجد شيئاً — وإلا فالمطابقةُ فضفاضةٌ تُرجع كلَّ شيء
  // وتبدو ناجحة. اختبارٌ سلبيٌّ لازم.
  const none = await search("ثلاجة");
  none.length === 0
    ? pass("«ثلاجة» ⇒ صفرُ نتائج (المطابقة ليست فضفاضة)")
    : fail(`«ثلاجة» أرجعت ${none.length} وكان يجب صفر`);

  // ── ٤) الفلاتر تتولّد ──────────────────────────────────────────
  logger.info("== الفلاتر تتولّد من الخصائص ==");
  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "products.id"],
  });

  const byName = new Map((categories as any[]).map((c) => [c.name, c]));
  const results: Record<string, string[]> = {};

  for (const name of ["إلكترونيات", "ملابس"]) {
    const cat = byName.get(name);
    if (!cat) { fail(`التصنيف «${name}» غير موجود — شغّل seed-catalog`); continue; }
    const filters = await catalog.getCategoryFilters(
      cat.id,
      (cat.products ?? []).map((p: any) => p.id)
    );
    results[name] = filters.map((f) => f.attribute_code);
    logger.info(`     ${name}: ${filters.map((f) => `${f.name_ar}(${f.values.length})`).join(" · ")}`);
  }

  const elec = results["إلكترونيات"] ?? [];
  const cloth = results["ملابس"] ?? [];

  elec.includes("storage") && !cloth.includes("storage")
    ? pass("«السعة» في إلكترونيات وحدها")
    : fail(`السعة: إلكترونيات=${elec} ملابس=${cloth}`);

  cloth.includes("size") && !elec.includes("size")
    ? pass("«المقاس» في ملابس وحدها")
    : fail(`المقاس: إلكترونيات=${elec} ملابس=${cloth}`);

  JSON.stringify(elec) !== JSON.stringify(cloth)
    ? pass("التصنيفان يُظهران فلترين مختلفين")
    : fail("التصنيفان أظهرا نفس الفلاتر — الفلاترُ ليست متولّدة");

  // 🔴 `is_filterable=false` يُحترم: «بلد المنشأ» مربوطةٌ بإلكترونيات
  // ولها قيمٌ في المنتجات، ومع ذلك **لا تُنتج فلتراً**.
  !elec.includes("origin")
    ? pass("«بلد المنشأ» (is_filterable=false) لا تُنتج فلتراً رغم وجود قيمها")
    : fail("خاصيةٌ غيرُ قابلةٍ للفلترة أنتجت فلتراً");

  // ── ٥) الفلاتر تعكس الموجود فعلاً ──────────────────────────────
  const elecCat = byName.get("إلكترونيات");
  if (elecCat) {
    const filters = await catalog.getCategoryFilters(
      elecCat.id,
      (elecCat.products ?? []).map((p: any) => p.id)
    );
    const colors = filters.find((f) => f.attribute_code === "color");
    const hasEmptyValue = filters.some((f) => f.values.some((v) => v.count === 0));
    colors && colors.values.length > 0 && !hasEmptyValue
      ? pass(`قيمُ الفلاتر من المنتجات فعلاً — لا قيمةَ بعدّادٍ صفر (${colors.values.map((v) => v.value).join("، ")})`)
      : fail("فلترٌ فيه قيمةٌ بلا منتجات");
  }

  // ── ٦) المرادفات بيانات ────────────────────────────────────────
  logger.info("== المرادفات بيانات لا كود ==");
  const before = await search("سماعة");
  await catalog.upsertSynonym({ term: "سماعة", synonyms: ["قميص"] });
  const after = await search("سماعة");
  before.length === 0 && after.length > 0
    ? pass("مرادفٌ أُضيف وقتَ التشغيل غيّر النتيجة — بلا نشرِ كود")
    : fail(`إضافةُ المرادف لم تُغيّر شيئاً (قبل=${before.length} بعد=${after.length})`);

  // تنظيف: المرادفُ التجريبيّ لا يبقى في القاعدة
  const [temp] = await catalog.listSearchSynonyms({ term_normalized: normalizeArabic("سماعة") });
  if (temp) await catalog.deleteSearchSynonyms([(temp as any).id]);

  // ── ٧) الدالّة الخالصة معزولة ──────────────────────────────────
  const isolated = expandWithSynonyms("أيفون", [{ term: "ايفون", synonyms: ["iphone"] }]);
  isolated.includes("ايفون") && isolated.includes("iphone")
    ? pass("expandWithSynonyms خالصةٌ وتعمل بلا قاعدة")
    : fail(`التوسيع المعزول أخطأ: ${JSON.stringify(isolated)}`);

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الكتالوج.`);
  logger.info("✅ كلُّ فحوص المرحلة ٢ اجتازت.");
}
