import { MedusaService } from "@medusajs/framework/utils";
import {
  Attribute,
  CategoryAttribute,
  ProductAttributeValue,
  SearchSynonym,
  SeoMeta,
  Translation,
  UrlRedirect,
} from "./models";
import { expandWithSynonyms, normalizeArabic } from "./arabic";

export type Filter = {
  attribute_code: string;
  name_ar: string;
  data_type: string;
  values: Array<{ value: string; count: number; selected: boolean }>;
};

/** ما اختاره الزائر: رمزُ الخاصية ⇐ قيمةٌ أو أكثر. */
export type Selection = Record<string, string[]>;

export type BrowseResult = {
  /** معرّفاتُ المنتجات الباقية بعد التصفية. */
  product_ids: string[];
  filters: Filter[];
};

/**
 * خدمة الكتالوج: الخصائص والفلاتر المتولّدة ومرادفات البحث.
 *
 * وما ليس هنا عمداً: المنتجاتُ والمتغيّراتُ والتصنيفات — تلك وحدةُ
 * Medusa، ولا نكرّرها. هذه الوحدة تضيف ما لا يقدّمه: **الفلاترُ
 * المشتقّة من الخصائص**، و**تطبيعُ العربية**، و**المرادفات**.
 */
class CatalogModuleService extends MedusaService({
  Attribute,
  CategoryAttribute,
  ProductAttributeValue,
  SearchSynonym,
  SeoMeta,
  Translation,
  UrlRedirect,
}) {
  /**
   * فلاترُ تصنيفٍ بعينه — مولَّدةً من خصائصه وقيمها الفعلية.
   *
   * 🔴 والقيمُ تأتي **مما هو موجودٌ في المنتجات فعلاً** لا من قائمةٍ
   * معرَّفةٍ مسبقاً: فلترٌ يعرض «أحمر» ولا منتجَ أحمر يُنتج نتيجةً
   * فارغة، وهي أسوأُ من غياب الفلتر — المستخدمُ يظنّ المتجرَ معطوباً.
   */
  /**
   * 🔴 **التصفيةُ بالخصائص** (بند ٣) — والفلاترُ معها في نداءٍ واحد.
   *
   * كانت الخصائصُ تُحسب وتُعرض بأعدادها **ولا مسارَ يصفّي بها**: وعدٌ
   * مرئيٌّ على الشاشة لا يفي. وهذه تُتمّه.
   *
   * ── وثلاثةُ قراراتٍ فيها، لكلٍّ بديلٌ مرفوض ────────────────────
   *
   * **١) داخلَ الخاصية «أو»، وبين الخصائص «و».** فمن اختار الأحمرَ
   * والأزرقَ يريد أيَّهما، ومن اختار الأحمرَ والمقاسَ L يريدهما معاً.
   * والبديلُ («و» في الكلّ) يُنتج نتيجةً فارغةً من أوّل اختيارَين —
   * ولا منتجَ أحمرُ وأزرقُ في آنٍ واحد.
   *
   * **٢) والمطابقةُ على `value_normalized`** لا على النصّ الخام: من
   * يكتب «احمر» بلا همزةٍ في الرابط يجد ما كُتب «أحمر». والتطبيعُ
   * مخزَّنٌ لا محسوبٌ وقتَ القراءة (`product-attribute-value.ts`).
   *
   * **٣) وعدَدُ كلِّ خاصيةٍ يُحسب على المجموعة المصفّاة بما عداها هي.**
   * وهذا أدقُّ ما هنا: لو حُسب اللونُ على المجموعة المصفّاة **باللون
   * أيضاً**، لصار كلُّ لونٍ غيرِ المختار صفراً — فيرى الزائرُ «أزرق
   * (٠)» ولا يستطيع التبديلَ إليه إلا بإلغاء اختياره أوّلاً. وهو عطبٌ
   * لا يشكو منه شيء، ويجعل الفلاترَ طريقاً ذا اتجاهٍ واحد.
   */
  async browseCategory(
    categoryId: string,
    productIds: string[],
    selection: Selection = {}
  ): Promise<BrowseResult> {
    const links = await this.listCategoryAttributes(
      { category_id: categoryId },
      { relations: ["attribute"], order: { sort_order: "ASC" } }
    );

    const filterable = (links as any[])
      .map((l) => l.attribute)
      .filter((a) => a?.is_filterable);

    if (!productIds.length || !filterable.length) {
      return { product_ids: productIds, filters: [] };
    }

    // كلُّ قيمِ الخصائص القابلة للفلترة لمنتجات هذا التصنيف — قراءةٌ
    // واحدة. والبديلُ استعلامٌ لكلّ خاصيةٍ ثم آخرُ لكلّ عدّ، وهو
    // N+1 على شاشةٍ تُفتح في كل زيارة.
    const rows = (await this.listProductAttributeValues({
      attribute_id: filterable.map((a) => a.id),
      product_id: productIds,
    })) as any[];

    /** رمزُ الخاصية ⇐ (معرّفُ المنتج ⇐ قيمتُه الخام) */
    const byCode = new Map<string, Map<string, string>>();
    /** رمزُ الخاصية ⇐ (معرّفُ المنتج ⇐ قيمتُه المطبَّعة) */
    const normByCode = new Map<string, Map<string, string>>();
    const codeOf = new Map<string, string>(filterable.map((a) => [a.id, a.code]));

    for (const r of rows) {
      const code = codeOf.get(r.attribute_id);
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, new Map());
        normByCode.set(code, new Map());
      }
      byCode.get(code)!.set(r.product_id, r.value);
      normByCode.get(code)!.set(r.product_id, r.value_normalized);
    }

    // الاختياراتُ تُطبَّع مرّةً — لا مرّةً لكل منتج.
    //
    // 🔴 **ويُسقَط اختيارُ خاصيةٍ لا وجودَ لها في هذا التصنيف.** وهذا
    // أُمسك بالقياس لا بالقراءة: `?attr[bogus]=x` كان يُعيد **صفرَ
    // منتجاتٍ** لا التصنيفَ كاملاً، لأن لا منتجَ يحمل قيمةً لخاصيةٍ
    // غيرِ موجودة فيسقط الجميع في اختبار «منتجٌ بلا قيمةٍ يخرج».
    //
    // وأثرُه ليس نظرياً: رابطٌ محفوظٌ أو مشاركٌ بخاصيةٍ حُذفت لاحقاً —
    // أو رابطُ تصنيفٍ لُصق على تصنيفٍ آخر — يُري صاحبَه تصنيفاً فارغاً
    // ويقول له «لا بضاعةَ هنا». وهي كذبةٌ سببُها معاملٌ ميت.
    const known = new Set(filterable.map((a) => a.code));
    const wanted = new Map<string, Set<string>>();
    for (const [code, values] of Object.entries(selection)) {
      if (!known.has(code)) continue;
      const set = new Set(values.map((v) => normalizeArabic(v)).filter(Boolean));
      if (set.size) wanted.set(code, set);
    }

    /** المنتجاتُ الباقيةُ بعد تطبيق كلِّ الاختيارات **عدا** `skip`. */
    const surviving = (skip?: string): string[] =>
      productIds.filter((pid) => {
        for (const [code, set] of wanted) {
          if (code === skip) continue;
          const v = normByCode.get(code)?.get(pid);
          // منتجٌ بلا قيمةٍ لخاصيةٍ مطلوبة **يخرج**: من طلب المقاسَ L
          // لا يريد ما لا مقاسَ له. وإبقاؤه يجعل الفلترَ اقتراحاً لا
          // تصفية.
          if (!v || !set.has(v)) return false;
        }
        return true;
      });

    const finalIds = surviving();

    const filters: Filter[] = [];
    for (const attribute of filterable) {
      const values = byCode.get(attribute.code);
      if (!values) continue;

      // القرار ٣: عدُّ هذه الخاصية على المجموعة المصفّاة بما عداها.
      const base = surviving(attribute.code);
      const norms = normByCode.get(attribute.code)!;
      const chosen = wanted.get(attribute.code);

      const counts = new Map<string, number>();
      for (const pid of base) {
        const raw = values.get(pid);
        if (raw) counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }

      // 🔴 **والمختارُ يبقى معروضاً ولو صار عدَدُه صفراً.**
      //
      // أُمسك بالقياس: «أزرق» + «٢٥٦ جيجا» يُعطيان صفرَ منتجات، وحين
      // يُحسب فلترُ اللون على المصفّى بالسعة **يختفي «أزرق» من قائمته
      // كلَّها** — فيرى الزائرُ نتيجةً فارغةً ولا يجد ما يُلغيه، ولا
      // مخرجَ له إلا «مسح الكل». وهو مصيدةٌ: يفقد اختيارَه الآخر معه.
      //
      // فيُضاف المختارُ بعدّهِ الحقيقي (صفراً) — يُرى، ويُنزع بضغطة.
      if (chosen) {
        for (const [pid, n] of norms) {
          const raw = values.get(pid);
          if (raw && chosen.has(n) && !counts.has(raw)) counts.set(raw, 0);
        }
      }

      if (!counts.size) continue;

      filters.push({
        attribute_code: attribute.code,
        name_ar: attribute.name_ar,
        data_type: attribute.data_type,
        values: [...counts.entries()]
          .map(([value, count]) => ({
            value,
            count,
            // «مختارة» تُحسب بالمطبَّع أيضاً: من كتب «احمر» في الرابط
            // يجب أن يرى «أحمر» مؤشَّرةً، وإلا ضغطها ثانيةً فأُلغيت.
            selected: Boolean(
              chosen &&
                [...norms.entries()].some(
                  ([pid, n]) => values.get(pid) === value && chosen.has(n)
                )
            ),
          }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ar")),
      });
    }

    return { product_ids: finalIds, filters };
  }

  async getCategoryFilters(categoryId: string, productIds: string[]): Promise<Filter[]> {
    const links = await this.listCategoryAttributes(
      { category_id: categoryId },
      { relations: ["attribute"], order: { sort_order: "ASC" } }
    );

    // غلافٌ على `browseCategory` بلا اختيارات — **ولا حسابٌ ثانٍ**.
    // كان هنا حسابٌ مستقلٌّ للأعداد، وحسابان في موضعين يفترقان يوماً
    // وأحدُهما يكذب. و`links` أعلاه تُقرأ مرّتين، وثمنُها استعلامٌ
    // واحدٌ على جدولٍ صغير — أرخصُ من منطقٍ مكرَّر.
    void links;
    const { filters } = await this.browseCategory(categoryId, productIds, {});
    return filters;
  }

  /**
   * كتابةُ قيمةِ خاصية — والتطبيعُ يُملأ هنا لا في المُنادي.
   *
   * فلو تُرك للمنادي لنسيَه أحدُهم يوماً، فصار صفٌّ لا يُطابقه بحثٌ
   * ولا فلتر — **وعطلٌ صامتٌ في بيانات، لا رسالةُ خطأ**.
   */
  async setProductAttribute(input: {
    product_id: string;
    attribute_id: string;
    value: string;
  }) {
    const payload = {
      ...input,
      value_normalized: normalizeArabic(input.value),
    };

    const [existing] = await this.listProductAttributeValues({
      product_id: input.product_id,
      attribute_id: input.attribute_id,
    });

    return existing
      ? await this.updateProductAttributeValues({ id: (existing as any).id, ...payload })
      : await this.createProductAttributeValues(payload);
  }

  /** إنشاءُ مرادفٍ — والتطبيعُ يُملأ هنا للسبب نفسه. */
  async upsertSynonym(input: { term: string; synonyms: string[] }) {
    const term_normalized = normalizeArabic(input.term);
    const [existing] = await this.listSearchSynonyms({ term_normalized });
    const payload = { ...input, term_normalized };

    return existing
      ? await this.updateSearchSynonyms({ id: (existing as any).id, ...payload })
      : await this.createSearchSynonyms(payload);
  }

  /**
   * بياناتُ SEO لكيان — **مع ارتدادٍ مبنيّ لا فراغ**.
   *
   * 🔴 صفحةٌ بلا `<title>` تظهر في جوجل باسم الرابط، وبلا وصفٍ يقتطع
   * جوجل سطراً عشوائياً من النصّ. فالارتدادُ ليس ترفاً: **أكثرُ
   * المنتجات لن يكتب لها أحدٌ SEO يدوياً أبداً**، والمبنيُّ آلياً من
   * الاسم والوصف أفضلُ من لا شيء بمراحل.
   */
  async getSeo(input: {
    entity: "product" | "category" | "brand" | "page";
    entity_id: string;
    locale?: string;
    fallback?: { title?: string; description?: string };
  }) {
    const locale = input.locale ?? "ar";
    const [stored] = await this.listSeoMetas({
      entity: input.entity,
      entity_id: input.entity_id,
      locale,
    });

    const title = (stored as any)?.title || input.fallback?.title || null;
    const description =
      (stored as any)?.description ||
      // الوصفُ المرتدّ يُقتطع عند ١٦٠ حرفاً — وهو ما يعرضه جوجل. وقطعُه
      // عند حدّ كلمةٍ لا وسطَها: «...جوال آيفون ١٥ بر» تبدو عطلاً.
      truncateAtWord(input.fallback?.description ?? "", 160) ||
      null;

    return {
      title,
      description,
      canonical_url: (stored as any)?.canonical_url ?? null,
      og_image: (stored as any)?.og_image ?? null,
      structured_data: (stored as any)?.structured_data ?? null,
      no_index: (stored as any)?.no_index ?? false,
      is_generated: !stored,
      locale,
    };
  }

  async setSeo(input: {
    entity: "product" | "category" | "brand" | "page";
    entity_id: string;
    locale?: string;
    title?: string | null;
    description?: string | null;
    canonical_url?: string | null;
    og_image?: string | null;
    no_index?: boolean;
  }) {
    const locale = input.locale ?? "ar";
    const [existing] = await this.listSeoMetas({
      entity: input.entity,
      entity_id: input.entity_id,
      locale,
    });
    const payload = { ...input, locale };
    return existing
      ? await this.updateSeoMetas({ id: (existing as any).id, ...payload })
      : await this.createSeoMetas(payload);
  }

  /**
   * يكتب ترجمةً واحدة (أو يستبدلها).
   *
   * والحقلُ المسموحُ تحرسه القاعدة لا هذه الدالّة (انظر قيدَ
   * `zadim_translation_field_check`) — فالكتابةُ من سكربتٍ أو من
   * هجرةٍ تمرّ على نفس الحارس.
   */
  async setTranslation(input: {
    entity_type: "product" | "product_variant" | "product_category" | "product_collection";
    entity_id: string;
    field: string;
    locale: string;
    value: string;
  }) {
    const [existing] = await this.listTranslations({
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      field: input.field,
      locale: input.locale,
    });
    return existing
      ? await this.updateTranslations({ id: (existing as any).id, value: input.value })
      : await this.createTranslations(input);
  }

  /**
   * ترجماتُ دفعةٍ من المعرّفات في لغةٍ واحدة، مرتّبةً للإلباس:
   * `{ [entity_id]: { [field]: value } }`.
   *
   * ── ولماذا بالمعرّف وحدَه لا بالنوع والمعرّف ──────────────────────
   *
   * لأن المُلبِسَ يمشي على ردٍّ لا يعرف شكلَه: منتجٌ فيه متغيّراتٌ فيها
   * تصنيفات. ولو احتاج النوعَ لاحتاج أن يستنتجه من موضع الكائن في
   * الشجرة — أو من بادئة معرّفه (`prod_`/`variant_`)، وهي عادةُ تسمية
   * لا عقد. ومعرّفاتُ Medusa فريدةٌ عبر الجداول كلِّها، فالمعرّفُ
   * وحدَه كافٍ ولا يلتبس.
   *
   * والنوعُ يبقى في الجدول لأنه يخدم **الكتابة**: به تُحصَر الحقول
   * المسموحة، وبه تُسرد ترجماتُ نوعٍ في اللوحة.
   */
  async translationsFor(
    ids: string[],
    locale: string
  ): Promise<Record<string, Record<string, string>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return {};

    const rows = await this.listTranslations({ entity_id: unique, locale });

    const byEntity: Record<string, Record<string, string>> = {};
    for (const r of rows as any[]) {
      (byEntity[r.entity_id] ??= {})[r.field] = r.value;
    }
    return byEntity;
  }

  /**
   * يُنشئ تحويلاً — **ويطوي السلاسل**.
   *
   * 🔴 المشكلة التي يحلّها: تغيّر `slug` مرّتين ⇒ أ←ب ثم ب←ج. والزائرُ
   * على «أ» يقفز قفزتين، وجوجل **يُضعِف الثقة مع كل قفزة**. فالطيُّ
   * يجعلها أ←ج مباشرةً.
   *
   * ويمنع الحلقة: ج←أ بعدهما تُرفض بدل أن تُنتج دوراناً لا ينتهي.
   */
  async addRedirect(input: { from_path: string; to_path: string; status?: 301 | 302 }) {
    const from = normalizePath(input.from_path);
    let to = normalizePath(input.to_path);

    if (from === to) {
      throw new Error("[zadim] مسارٌ يحوّل إلى نفسه — حلقةٌ لا نهائية.");
    }

    // اتبع سلسلةَ الوجهة إلى نهايتها، بسقفٍ يمنع الدوران الأبديّ لو
    // تسلّلت حلقةٌ من بياناتٍ قديمة.
    const seen = new Set<string>([from, to]);
    for (let hop = 0; hop < 10; hop++) {
      const [next] = await this.listUrlRedirects({ from_path: to });
      if (!next) break;
      const target = normalizePath((next as any).to_path);
      if (seen.has(target)) {
        throw new Error(`[zadim] التحويل يُنتج حلقة: ${from} ⇒ ${target}`);
      }
      seen.add(target);
      to = target;
    }

    if (from === to) {
      throw new Error("[zadim] بعد طيّ السلسلة صار المسار يحوّل إلى نفسه.");
    }

    // وكلُّ ما كان يحوّل إلى `from` يُعاد توجيهه إلى `to` — فلا يبقى
    // زائرٌ يقفز قفزتين.
    const incoming = await this.listUrlRedirects({ to_path: from });
    for (const r of incoming as any[]) {
      if (normalizePath(r.from_path) !== to) {
        await this.updateUrlRedirects({ id: r.id, to_path: to });
      }
    }

    const [existing] = await this.listUrlRedirects({ from_path: from });
    const payload = { from_path: from, to_path: to, status: input.status ?? 301 };
    return existing
      ? await this.updateUrlRedirects({ id: (existing as any).id, ...payload })
      : await this.createUrlRedirects(payload);
  }

  /** يبحث عن تحويلٍ لمسار، ويعدّ الإصابة. */
  async resolveRedirect(path: string) {
    const [redirect] = await this.listUrlRedirects({ from_path: normalizePath(path) });
    if (!redirect) return null;
    await this.updateUrlRedirects({
      id: (redirect as any).id,
      hits: ((redirect as any).hits ?? 0) + 1,
    });
    return {
      to_path: (redirect as any).to_path,
      status: (redirect as any).status,
    };
  }

  /**
   * يوسّع استعلامَ المستخدم بمرادفاته المطبَّعة.
   *
   * ويُعيد **مصفوفةً دائماً** فيها الاستعلامُ المطبَّع على الأقل —
   * فمن ينادي هذه الدالّة لا يحتاج أن يفحص الفراغ.
   */
  async expandQuery(query: string): Promise<string[]> {
    const synonyms = await this.listSearchSynonyms({ is_active: true });
    return expandWithSynonyms(
      query,
      (synonyms as any[]).map((s) => ({
        term: s.term,
        synonyms: Array.isArray(s.synonyms) ? s.synonyms : [],
      }))
    );
  }
}

/** يقصّ عند حدّ كلمةٍ لا وسطَها — القصُّ وسطَ كلمةٍ يبدو عطلاً. */
function truncateAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** مسارٌ موحَّد: بشرطةٍ بادئة، بلا شرطةٍ لاحقة، بلا استعلام. */
function normalizePath(path: string): string {
  const p = String(path).split("?")[0].split("#")[0].trim();
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

export default CatalogModuleService;
