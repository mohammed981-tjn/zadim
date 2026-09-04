/**
 * منطقُ العرض والفرق — **دوالُّ خالصة**.
 *
 * ── ما قِيس على Medusa 2.19.0 قبل كتابة سطرٍ من هذا ──────────────
 *
 * سلّةٌ فيها قطعتان بسعر ١٢٩٠٠، ثم رُفع السعرُ ٥٠٪ والسلّةُ مفتوحة:
 *
 * ```
 * المعروضُ للعميل            total = 32545
 * بعد رفع السعر (قراءة)      total = 32545
 * بعد refreshCartItems       total = 32545   ← ولا يزال
 * وتمّ الطلبُ بلا اعتراض      total = 32545
 * ```
 *
 * **فالسعرُ يُجمَّد عند الإضافة ولا يُقرأ ثانيةً أبداً.** وهذا يخالف
 * العقد (`04-api-contract.md`): «أعِد قراءة الأسعار **من المصدر** لا
 * من السلة».
 *
 * وليس تفصيلاً تجميلياً: سلّةٌ فُتحت قبل شهرٍ تُتمّ بسعر الشهر الماضي،
 * ومنتجٌ سُعِّر خطأً بريالٍ بدل ألف يبقى قابلاً للشراء بريالٍ في **كل
 * سلّةٍ مفتوحة** بعد أن يُصحَّح الخطأ. والتاجرُ يظنّ أنه أغلق الباب.
 *
 * ── والعلاجُ ليس إعادةَ التسعير بصمت ─────────────────────────────
 *
 * أن نقرأ السعرَ الجديد ونُتمّ به **أسوأ**: العميلُ يدفع ما لم يره.
 * فالمقرَّر: **يُقرأ، ويُقارَن، ويُرفض إن اختلف** — ويُعرض الفرقُ
 * ويقرّر العميل. وهو نصُّ البوّابة حرفياً.
 */

export type CartLine = {
  id: string;
  variant_id: string;
  title?: string | null;
  quantity: number;
  unit_price: number;
};

export type PriceDrift = {
  line_id: string;
  variant_id: string;
  title: string | null;
  quantity: number;
  /** ما رآه العميل ووافق عليه. */
  quoted_unit_price: number;
  /** ما يقوله المصدرُ الآن. */
  current_unit_price: number;
  /** موجبٌ إن ارتفع. */
  difference: number;
};

/**
 * المبالغُ تعود كائناتِ BigNumber من طبقة الاستعلام: `===` عليها يقارن
 * الهويّة **فيكذب دائماً**. ولا تُقارَن قيمةٌ ماليّةٌ إلا بعد هذه.
 * (عطلٌ وقع فعلاً في أوّل استقصاء.)
 *
 * ── 🔴 والتقريبُ إلى هللةٍ صحيحة — وهو ما كان غائباً ───────────────
 *
 * قِيس في 2026-09-04 أن منتجاً سعرُه **٩٩٫٩٩ ريالاً لا يمكن شراؤه من
 * هذا المتجر إطلاقاً**:
 *
 * ```
 * السلّةُ الحيّة   total = 14373.85   (ضريبةُ ١٥٪ = 1874.85)
 * العرضُ المخزَّن  total = 14374      (العمودُ integer فيُقرَّب عند الكتابة)
 * الإتمام         ⛔ PRICE_CHANGED · difference = -0.15
 * ```
 *
 * وهي حلقةٌ **لا تنتهي**: كلُّ إعادةِ عرضٍ تخزّن الصحيحَ وتقارنه
 * بالكسريّ، فتختلفان أبداً. والعميلُ يرى «تغيّر سعرُك» ولم يتغيّر شيء.
 *
 * ولماذا لم تُمسكه بوّابةٌ واحدةٌ من خمسَ عشرة: لأن ضريبةَ ١٥٪ تُنتج
 * هللةً صحيحةً **فقط إن كان المبلغُ من مضاعفات العشرين** (٠٫١٥س = ٣س/٢٠)،
 * وسعرا البذرة ١٢٩٠٠ و٣٩٩٠٠ كلاهما كذلك — **صدفةً لا قصداً**. فالمتجرُ
 * أخضرُ في كل فحصٍ ولا يبيع منتجاً بسعرٍ عاديّ.
 *
 * والتقريبُ هنا لا في مكانٍ آخر لأن هذه **معبرُ المال الوحيد** إلى
 * منطقنا: منها يُخزَّن العرضُ ومنها يُقارَن الحيّ، فيتّفقان بالضرورة لا
 * بالحظّ. وهو نفسُ ما يفعله مشترِكُ الفاتورة (`halalas()`) منذ كُتب —
 * فصار المسارُ كلُّه على قاعدةٍ واحدة: **الهللةُ عددٌ صحيح** (ADR-008).
 */
export const amount = (v: unknown): number => Math.round(Number((v as any) ?? 0));

/** نفسُها بلا تقريب — لفحصِ ثابتٍ حسابيٍّ لا لتقييدِ مال. */
export const rawAmount = (v: unknown): number => Number((v as any) ?? 0);

/**
 * الفروقُ بين ما في السلّة وما في المصدر.
 *
 * والمتغيّرُ **الذي لا سعرَ له الآن** يُعدّ فرقاً لا يُتجاهل: منتجٌ
 * سُحب سعرُه لا يُباع بسعرٍ قديمٍ محفوظٍ في سلّة.
 */
export function priceDrift(
  lines: CartLine[],
  currentPrices: Map<string, number | null | undefined>
): PriceDrift[] {
  const out: PriceDrift[] = [];

  for (const line of lines) {
    const quoted = amount(line.unit_price);
    const raw = currentPrices.get(line.variant_id);
    const current = raw === null || raw === undefined ? null : amount(raw);

    // لا سعرَ الآن ⇒ فرقٌ لا يُتجاهل. ويُعرض `current = 0` لأن الواجهة
    // تعرض رقماً، والرسالةُ العربية هي التي تشرح.
    if (current === null || quoted !== current) {
      out.push({
        line_id: line.id,
        variant_id: line.variant_id,
        title: line.title ?? null,
        quantity: Number(line.quantity) || 0,
        quoted_unit_price: quoted,
        current_unit_price: current ?? 0,
        difference: (current ?? 0) - quoted,
      });
    }
  }

  return out;
}

/**
 * بصمةُ السلّة: ما فيها من متغيّراتٍ وكمّياتٍ وأسعار.
 *
 * وتُميّز حالتين تبدوان واحدةً وليستا: **تغيّرَ السعر** (العرضُ باطلٌ
 * ويُعرض الفرق) من **تغيّرت السلّة** (العميلُ نفسُه أضاف صنفاً، فالعرضُ
 * قديمٌ لا مخالف). ورسالةُ «تغيّر السعر» لمن أضاف صنفاً بنفسه تُربكه.
 */
export function fingerprint(lines: CartLine[]): string {
  return lines
    .map((l) => `${l.variant_id}:${Number(l.quantity) || 0}:${amount(l.unit_price)}`)
    .sort()
    .join("|");
}

export type Totals = {
  currency_code: string;
  item_total: number;
  shipping_total: number;
  tax_total: number;
  discount_total: number;
  total: number;
};

export function totalsOf(cart: any): Totals {
  return {
    currency_code: String(cart?.currency_code ?? ""),
    item_total: amount(cart?.item_total),
    shipping_total: amount(cart?.shipping_total),
    tax_total: amount(cart?.tax_total),
    discount_total: amount(cart?.discount_total),
    total: amount(cart?.total),
  };
}

/**
 * نفسُها **بلا تقريب** — ولا تُقيَّد ولا تُعرض، تُفحص بها المعادلة.
 *
 * ولماذا لزمت: التوازنُ أدناه ثابتٌ **حسابيٌّ عن أرقام Medusa الخام**
 * (`item_total + shipping_total = total` يصحّ فيها بالضبط، وقُرئ في
 * `utils/totals/cart`). وفحصُه على أرقامٍ قُرِّب كلٌّ منها على حدة
 * يقيس **ضجيجَ التقريب** لا صحّةَ الحساب: قِيس أن ١٢ تركيبةً من ١٠٥
 * تجعل `round(س) + round(ص) ≠ round(س+ص)` بهللةٍ واحدة (مثالها منتجٌ
 * بـ٩٩٫٩٠ وشحنٌ بـ١٩٫٩٩).
 *
 * ولو فُحص على المقرَّب لصار إصلاحُ ADR-034 يستبدل عائقاً بعائق: بدل
 * `PRICE_CHANGED` أبداً يقع `TOTALS_UNBALANCED` أحياناً — وكلاهما يمنع
 * بيعاً مشروعاً.
 *
 * فالتسامحُ يبقى **صفراً** كما هو مكتوب، ويُطبَّق حيث يصحّ.
 */
export function rawTotalsOf(cart: any): Totals {
  return {
    currency_code: String(cart?.currency_code ?? ""),
    item_total: rawAmount(cart?.item_total),
    shipping_total: rawAmount(cart?.shipping_total),
    tax_total: rawAmount(cart?.tax_total),
    discount_total: rawAmount(cart?.discount_total),
    total: rawAmount(cart?.total),
  };
}

/**
 * توازنُ المجاميع — الثابتُ الذي يجب أن يصحّ دائماً.
 *
 * ⚠️ **ولماذا هنا لا في القاعدة**: Medusa **لا يخزّن هذه المجاميع**؛
 * يحسبها عند القراءة من البنود وتسويّاتها وسطور ضريبتها. و`CHECK` لا
 * يحرس ما لا يُخزَّن. فالحارسُ اختبارٌ يُشغَّل في CI، ومكتوبٌ هنا أنه
 * ليس قيداً — كي لا يظنّه قارئٌ لاحقٌ مضموناً في القاعدة وهو ليس كذلك.
 *
 * والفرقُ المسموح **صفر**: الهللاتُ أعدادٌ صحيحة (ADR-008)، وفرقُ
 * هللةٍ واحدةٍ في متجرٍ يبيع مليوناً هو عشرةُ آلاف ريالٍ لا يعرف أحدٌ
 * أين ذهبت.
 */
export function totalsBalance(t: Totals): { ok: boolean; expected: number; diff: number } {
  const expected = t.item_total + t.shipping_total;
  return { ok: expected === t.total, expected, diff: t.total - expected };
}
