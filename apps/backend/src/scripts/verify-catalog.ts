import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../modules/catalog";
import type CatalogModuleService from "../modules/catalog/service";
import { normalizeArabic, expandWithSynonyms, matchesAnyTerm } from "../modules/catalog/arabic";
import { processProductImage, IMAGE_SIZES } from "../modules/catalog/images";

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
    // نفسُ دالّة المسار لا نسخةٌ منها: النسختان تفترقان، وقد افترقتا
    // فعلاً — فمرّ عطلُ «جوال ⇒ سمّاعة» في الفحص لأنه كان يحمل نفسَ
    // الخطأ الذي يفحصه.
    return (products as any[]).filter((p) =>
      matchesAnyTerm(`${p.title ?? ""} ${p.description ?? ""} ${p.handle ?? ""}`, terms)
    );
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

  // ── ٥ب) 🔴 التصفيةُ بالخصائص — أربعُ دلالاتٍ لكلٍّ بديلٌ مرفوض ──
  //
  // كانت الخصائصُ تُحسب وتُعرض بأعدادها **ولا مسارَ يصفّي بها**: وعدٌ
  // مرئيٌّ على الشاشة لا يفي. وهذه تحرس ما بُني.
  logger.info("== التصفيةُ بالخصائص ==");
  if (elecCat) {
    const ids = (elecCat.products ?? []).map((p: any) => p.id);
    const browse = (sel: Record<string, string[]>) =>
      catalog.browseCategory(elecCat.id, ids, sel);

    const all = await browse({});
    const colorFilter = all.filters.find((f) => f.attribute_code === "color");
    const twoColors = (colorFilter?.values ?? []).slice(0, 2).map((v) => v.value);

    if (twoColors.length < 2) {
      fail("يلزم لونان مختلفان في إلكترونيات لفحص التصفية — شغّل seed-catalog");
    } else {
      const [c1, c2] = twoColors;

      const one = await browse({ color: [c1] });
      one.product_ids.length > 0 && one.product_ids.length < all.product_ids.length
        ? pass(`اختيارُ «${c1}» يُضيّق (${all.product_ids.length} ⇐ ${one.product_ids.length})`)
        : fail(`التصفيةُ لم تُضيّق: ${all.product_ids.length} ⇐ ${one.product_ids.length}`);

      // ١) داخلَ الخاصية «أو» — ولو كانت «و» لصار الجوابُ صفراً، ولا
      //    منتجَ بلونين في آن.
      const both = await browse({ color: [c1, c2] });
      both.product_ids.length > one.product_ids.length
        ? pass("وقيمتان لنفس الخاصية «أو» لا «و» — وإلا لصار الجوابُ صفراً")
        : fail(`«أو» داخل الخاصية لا تعمل: ${both.product_ids.length} ≤ ${one.product_ids.length}`);

      // ٢) 🔴 وعدُّ الخاصية يُحسب على المصفّى **بما عداها هي**.
      //    ولولاه لصار كلُّ لونٍ غيرِ المختار صفراً، فلا يستطيع الزائرُ
      //    التبديلَ إليه — والفلاترُ طريقٌ ذو اتجاهٍ واحد.
      const after = one.filters.find((f) => f.attribute_code === "color");
      const other = after?.values.find((v) => v.value === c2);
      other && other.count > 0
        ? pass(`وبعد اختيار «${c1}» يبقى «${c2}» بعددٍ حقيقيّ (${other.count}) — فالتبديلُ ممكن`)
        : fail("عدُّ اللون حُسب على المصفّى باللون نفسِه — لا تبديلَ بعد الاختيار");

      after?.values.find((v) => v.value === c1)?.selected === true
        ? pass("والمختارُ مؤشَّرٌ في ردّ الخادم لا في المتصفّح")
        : fail("المختارُ غيرُ مؤشَّر");

      // ٣) 🔴 وخاصيةٌ لا وجودَ لها **تُتجاهَل** ولا تُفرغ التصنيف.
      //    أُمسك بالقياس: كانت تُعيد صفرَ منتجاتٍ لأن لا منتجَ يحمل
      //    قيمةً لها — فرابطٌ محفوظٌ بخاصيةٍ حُذفت يقول «لا بضاعةَ هنا».
      const bogus = await browse({ zzz_not_an_attribute: ["x"] });
      bogus.product_ids.length === all.product_ids.length
        ? pass("وخاصيةٌ مجهولةٌ تُتجاهَل — رابطٌ قديمٌ يعرض التصنيفَ كاملاً لا فارغاً")
        : fail(`خاصيةٌ مجهولةٌ أفرغت التصنيف (${bogus.product_ids.length})`);

      // ٤) 🔴 والمختارُ يبقى معروضاً ولو صار عدَدُه صفراً.
      //    أُمسك بالقياس أيضاً: تقاطعٌ فارغٌ كان **يُخفي المختارَ من
      //    قائمته**، فلا يجد الزائرُ ما يُلغيه ولا مخرجَ إلا «مسح الكل»
      //    — فيفقد اختيارَه الآخر معه.
      const storageFilter = all.filters.find((f) => f.attribute_code === "storage");
      const impossible = storageFilter?.values.find(
        (v) => !one.filters.find((f) => f.attribute_code === "storage")?.values.some((x) => x.value === v.value)
      );
      if (impossible) {
        const dead = await browse({ color: [c1], storage: [impossible.value] });
        const shown = dead.filters
          .find((f) => f.attribute_code === "storage")
          ?.values.find((v) => v.value === impossible.value);
        dead.product_ids.length === 0 && shown?.selected === true && shown.count === 0
          ? pass("وتقاطعٌ فارغٌ يُبقي المختارَ ظاهراً بعدّادِ صفر — فيُنزع بضغطة لا بـ«مسح الكل»")
          : fail(`المختارُ اختفى عند التقاطع الفارغ: ${JSON.stringify(shown ?? null)}`);
      } else {
        // لا تقاطعَ فارغاً في البذرة — يُقال ولا يُدَّعى نجاحٌ لم يُقس.
        logger.info("     ℹ️  لا تقاطعَ فارغاً في بيانات البذرة — لم يُفحص بقاءُ المختار");
      }
    }
  }

  // ── ٦) المرادفات بيانات ────────────────────────────────────────
  logger.info("== المرادفات بيانات لا كود ==");
  // ⚠️ **كلمةٌ لا وجودَ لها في أي كتالوج** لا كلمةٌ نظنُّها غيرَ موجودة.
  // كانت «سماعة»، ثم أضافت بذرةُ التجارة منتجاً اسمُه «سمّاعة زادم»
  // فصار «قبل = 1» وسقط الفحص — **اختبارٌ بُني على غياب بيانات ينكسر
  // يوم تصل البيانات**، وينكسر بلا أن يكون في الكود عطل.
  const ghost = "زربولية";
  const before = await search(ghost);
  await catalog.upsertSynonym({ term: ghost, synonyms: ["قميص"] });
  const after = await search(ghost);
  before.length === 0 && after.length > 0
    ? pass("مرادفٌ أُضيف وقتَ التشغيل غيّر النتيجة — بلا نشرِ كود")
    : fail(`إضافةُ المرادف لم تُغيّر شيئاً (قبل=${before.length} بعد=${after.length})`);

  // ولا يبقى أثرُ الفحص في بيانات المتجر.
  const ghostRows = await catalog.listSearchSynonyms({});
  const mineSyn = (ghostRows as any[]).filter((r) => r.term === ghost);
  if (mineSyn.length) await catalog.deleteSearchSynonyms(mineSyn.map((r) => r.id));

  // ولا يُرجع البحثُ عن «جوال» سمّاعةَ رأسٍ لأن اسمَها يحوي `phone`.
  const jawwal = await search("جوال");
  !jawwal.some((p: any) => p.handle === "zadim-headphones")
    ? pass("«جوال» لا تُرجع zadim-headphones — المطابقةُ بكلمةٍ لا باحتواء")
    : fail("«جوال» أرجعت سمّاعةَ الرأس — عادت مطابقةُ الاحتواء");

  // تنظيف: المرادفُ التجريبيّ لا يبقى في القاعدة
  const [temp] = await catalog.listSearchSynonyms({ term_normalized: normalizeArabic("سماعة") });
  if (temp) await catalog.deleteSearchSynonyms([(temp as any).id]);

  // ── ٧) الدالّة الخالصة معزولة ──────────────────────────────────
  const isolated = expandWithSynonyms("أيفون", [{ term: "ايفون", synonyms: ["iphone"] }]);
  isolated.includes("ايفون") && isolated.includes("iphone")
    ? pass("expandWithSynonyms خالصةٌ وتعمل بلا قاعدة")
    : fail(`التوسيع المعزول أخطأ: ${JSON.stringify(isolated)}`);

  // ── ٨) الصور (بند ٥٥) ─────────────────────────────────────────
  logger.info("== معالجة الصور ==");
  const sharp = (await import("sharp")).default;

  // صورةٌ واقعية بضجيجٍ عشوائيّ — لا لونٌ مسطّح: اللونُ المسطّح يُعطي
  // نسبَ ضغطٍ خياليةً تُخفي أداءً حقيقياً سيّئاً.
  const W = 2400, H = 1600;
  const raw = Buffer.alloc(W * H * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 256;
  const photo = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();

  const images = await processProductImage(photo);

  images.length === IMAGE_SIZES.length
    ? pass(`رفعةٌ واحدة ⇒ ${images.length} أحجام`)
    : fail(`عددُ الأحجام ${images.length} لا ${IMAGE_SIZES.length}`);

  images.every((i) => i.mime === "image/webp")
    ? pass("كلُّها WebP")
    : fail("نسخةٌ ليست WebP");

  new Set(images.map((i) => i.width)).size === images.length
    ? pass(`أبعادٌ متفاوتة: ${images.map((i) => `${i.width}×${i.height}`).join(" · ")}`)
    : fail("أحجامٌ متطابقة الأبعاد");

  const biggest = images[images.length - 1];
  biggest.bytes < photo.byteLength
    ? pass(`توفير ${(100 - (biggest.bytes / photo.byteLength) * 100).toFixed(0)}٪ على أكبر نسخة (${(photo.byteLength / 1048576).toFixed(1)}م ⇒ ${(biggest.bytes / 1024).toFixed(0)}ك)`)
    : fail("أكبرُ نسخةٍ أكبرُ من الأصل");

  // النِّسَبُ محفوظة: صورةٌ 3:2 تبقى 3:2 في كل حجم — والتشويهُ في صور
  // المنتجات شكوى «الصورة لا تشبه البضاعة».
  const ratios = images.map((i) => (i.width / i.height).toFixed(2));
  new Set(ratios).size === 1
    ? pass(`نسبةُ الأبعاد محفوظة في الأحجام كلِّها (${ratios[0]})`)
    : fail(`النِّسَب اختلفت: ${ratios.join(" · ")}`);

  // لا تكبير: صورةٌ أصغرُ من أكبر حجمٍ لا تُمدَّد — التمديدُ ضبابيةٌ
  // أكبرُ حجماً لا جودةٌ أعلى.
  const small = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 } },
  }).png().toBuffer();
  const smallOut = await processProductImage(small);
  smallOut.every((i) => i.width <= 400)
    ? pass("صورةٌ ٤٠٠ عرضاً لا تُكبَّر إلى ١٦٠٠")
    : fail(`كُبِّرت: ${smallOut.map((i) => i.width).join(",")}`);

  // دورانُ EXIF: صورُ الهواتف تُخزَّن أفقيةً بعلَمِ دوران، ومن يُسقط
  // العلَم يعرض المنتجَ مقلوباً.
  const rotated = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: { r: 10, g: 200, b: 10 } },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rotOut = await processProductImage(rotated);
  rotOut[0].height > rotOut[0].width
    ? pass("علَمُ EXIF مُطبَّق — الصورةُ لا تُعرض مقلوبة")
    : fail("دورانُ EXIF أُسقط");

  // ملفٌّ ليس صورة يُرفض ولا يُخزَّن.
  try {
    await processProductImage(Buffer.from("هذا ليس صورة"));
    fail("ملفٌّ ليس صورةً قُبل");
  } catch {
    pass("ملفٌّ ليس صورةً يُرفض");
  }

  // ── ٩) SEO (بند ٣٨) ───────────────────────────────────────────
  logger.info("== SEO والتحويلات ==");
  const iphone = (products as any[]).find((p) => p.handle === "iphone-15-pro");

  if (iphone) {
    // الارتداد: لا سطرَ محفوظ ⇒ يُبنى من الاسم والوصف.
    //
    // ⚠️ بمعرّفٍ لا وجودَ له لا بمعرّف الـiPhone: الفحصُ أدناه **يكتب**
    // سطرَ SEO لآيفون، فلو استعملتُه هنا لنجح الفحصُ أوّلَ مرّة وسقط
    // في كل إعادة — واختبارٌ يمرّ مرّةً واحدة يسقط في CI ثم يُتجاهَل.
    const generated = await catalog.getSeo({
      entity: "product",
      entity_id: `never-stored-${Date.now()}`,
      fallback: { title: iphone.title, description: iphone.description },
    });
    generated.is_generated && generated.title === iphone.title
      ? pass(`منتجٌ بلا SEO ⇒ عنوانٌ مبنيّ «${generated.title}»`)
      : fail(`الارتدادُ لم يعمل: ${JSON.stringify(generated)}`);

    // القصُّ عند حدّ كلمةٍ لا وسطَها.
    const longDesc = "جوال ".repeat(60);
    const cut = await catalog.getSeo({
      entity: "product",
      entity_id: "no-such-id",
      fallback: { description: longDesc },
    });
    const d = cut.description ?? "";
    // التأكيدُ الصحيح: النصُّ المقصوص (بلا «…») **بادئةٌ** من الأصل،
    // والحرفُ التالي له في الأصل **مسافة** — أي أن القطع وقع بين
    // كلمتين لا داخل كلمة. وكان تأكيدي أوّلاً `!/\S…$/` وهو معكوس:
    // القطعُ السليم ينتهي بحرفٍ غيرِ مسافة (آخرِ كلمةٍ كاملة) قبل «…».
    const body = d.replace(/…$/, "");
    const source = longDesc.replace(/\s+/g, " ").trim();
    const cutAtWordBoundary =
      source.startsWith(body) &&
      (source.length === body.length || source[body.length] === " ");
    d.length <= 161 && d.endsWith("…") && cutAtWordBoundary
      ? pass(`وصفٌ طويلٌ يُقصّ عند ${d.length} حرفاً وبين كلمتين لا داخل كلمة`)
      : fail(`القصُّ أخطأ: ${d.length} حرفاً · بين كلمتين=${cutAtWordBoundary} · «${d.slice(-15)}»`);

    // المحفوظُ يغلب المبنيّ.
    await catalog.setSeo({
      entity: "product",
      entity_id: iphone.id,
      title: "آيفون ١٥ برو — أفضل سعر في السعودية",
      description: "اشترِ آيفون ١٥ برو بضمانٍ رسميّ وتوصيلٍ سريع.",
    });
    const stored = await catalog.getSeo({
      entity: "product",
      entity_id: iphone.id,
      fallback: { title: iphone.title },
    });
    !stored.is_generated && stored.title?.includes("أفضل سعر")
      ? pass("المحفوظُ يغلب المبنيّ")
      : fail(`المحفوظ لم يغلب: ${JSON.stringify(stored)}`);

    // تنظيف: الفحصُ لا يترك أثراً في القاعدة. وفحصٌ يُلوّث ما يفحصه
    // يُفسد الفحصَ التالي، وأسوأُ منه أن يُفسد بياناتِ تطويرٍ يعتمدها غيرُه.
    const [written] = await catalog.listSeoMetas({
      entity: "product",
      entity_id: iphone.id,
      locale: "ar",
    });
    if (written) await catalog.deleteSeoMetas([(written as any).id]);
  }

  // ── التحويلات ─────────────────────────────────────────────────
  const suffix = Date.now();
  const A = `/p/a-${suffix}`, B = `/p/b-${suffix}`, C = `/p/c-${suffix}`;

  await catalog.addRedirect({ from_path: A, to_path: B });
  await catalog.addRedirect({ from_path: B, to_path: C });

  // 🔴 طيُّ السلسلة: بعد أ←ب ثم ب←ج يجب أن تصير **أ←ج مباشرةً**.
  // وكلُّ قفزةٍ زائدة يُضعِف جوجل الثقةَ عندها، والزائرُ ينتظر رحلتين.
  const resolvedA = await catalog.resolveRedirect(A);
  resolvedA?.to_path === C
    ? pass(`طيُّ السلسلة: ${A} ⇒ ${C} مباشرةً (لا قفزتان)`)
    : fail(`السلسلة لم تُطوَ: ${A} ⇒ ${resolvedA?.to_path}`);

  // حلقة: ج←أ بعدهما تُرفض.
  try {
    await catalog.addRedirect({ from_path: C, to_path: A });
    fail("حلقةُ تحويلٍ قُبلت");
  } catch {
    pass("حلقةُ تحويل (ج⇒أ) تُرفض");
  }

  // تحويلٌ إلى النفس يُرفض.
  try {
    await catalog.addRedirect({ from_path: A, to_path: A });
    fail("تحويلٌ إلى النفس قُبل");
  } catch {
    pass("تحويلٌ إلى النفس يُرفض");
  }

  // توحيدُ المسار: بشرطةٍ لاحقةٍ أو باستعلام ⇒ نفسُ التحويل.
  const viaSlash = await catalog.resolveRedirect(`${A}/`);
  const viaQuery = await catalog.resolveRedirect(`${A}?utm_source=x`);
  viaSlash?.to_path === C && viaQuery?.to_path === C
    ? pass("المسارُ يُوحَّد: شرطةٌ لاحقة واستعلامٌ لا يكسران التحويل")
    : fail(`التوحيد أخفق: «/»⇒${viaSlash?.to_path} «?»⇒${viaQuery?.to_path}`);

  // العدّاد يزيد — وهو ما يُري المديرَ أي روابطَ قديمة ما زالت حيّة.
  const [counted] = await catalog.listUrlRedirects({ from_path: A });
  ((counted as any)?.hits ?? 0) >= 3
    ? pass(`عدّادُ الإصابات يزيد (${(counted as any).hits})`)
    : fail(`العدّاد لم يزد: ${(counted as any)?.hits}`);

  // تنظيف
  const mine = (await catalog.listUrlRedirects({})).filter((r: any) =>
    String(r.from_path).includes(String(suffix))
  );
  if (mine.length) await catalog.deleteUrlRedirects(mine.map((r: any) => r.id));

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الكتالوج.`);
  logger.info("✅ كلُّ فحوص المرحلة ٢ اجتازت.");
}
