import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createCartWorkflow,
  addShippingMethodToCartWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";
import { runCheckout, runQuote } from "../modules/checkout/orchestrate";
import { fingerprint, priceDrift, totalsBalance } from "../modules/checkout/pricing";
import {
  normalizeSaudiMobile,
  toMedusaAddress,
  validateNationalAddress,
} from "../modules/checkout/national-address";

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

  // ── العنوانُ الوطنيّ — منطقٌ خالصٌ يُفحص بلا قاعدة ──────────────
  const GOOD = {
    first_name: "محمد",
    last_name: "العتيبي",
    phone: "0555000111",
    building_number: "2743",
    street: "طريق الملك فهد",
    district: "العليا",
    city: "الرياض",
    postal_code: "12211",
    additional_number: "6889",
  };

  validateNationalAddress(GOOD).valid
    ? pass("عنوانٌ وطنيٌّ كاملٌ يُقبل")
    : fail(`عنوانٌ صحيحٌ رُفض: ${JSON.stringify(validateNationalAddress(GOOD))}`);

  // 🔴 وكلُّ حقلٍ إلزاميٍّ يُرفض غيابُه — حقلاً حقلاً، لا عيّنةً منها.
  // فحقلٌ يُنسى من الفحص هو الحقلُ الذي يُنسى من النموذج.
  for (const field of [
    "first_name",
    "last_name",
    "phone",
    "building_number",
    "street",
    "district",
    "city",
    "postal_code",
    "additional_number",
  ]) {
    const bad = { ...GOOD, [field]: "" };
    const r = validateNationalAddress(bad);
    !r.valid && r.errors.some((e) => e.field === field)
      ? pass(`غيابُ «${field}» يُرفض ويُسمّى`)
      : fail(`غيابُ «${field}» مرّ`);
  }

  // الأطوالُ الرقمية: أربعةٌ وخمسةٌ بالضبط لا «أربعةٌ فأكثر»
  const lens: Array<[string, string]> = [
    ["building_number", "274"],
    ["building_number", "27431"],
    ["postal_code", "1221"],
    ["postal_code", "122111"],
    ["additional_number", "688"],
  ];
  let lenOk = 0;
  for (const [field, value] of lens) {
    const r = validateNationalAddress({ ...GOOD, [field]: value });
    if (!r.valid && r.errors.some((e) => e.field === field)) lenOk++;
  }
  lenOk === lens.length
    ? pass(`الأطوالُ الرقمية تُفحص بالضبط (${lenOk}/${lens.length})`)
    : fail(`مرّ طولٌ خاطئ: ${lenOk}/${lens.length}`);

  // الأرقامُ الهندية تُطبَّع ولا تُرفض — الناسُ يكتبونها
  const indic = validateNationalAddress({ ...GOOD, building_number: "٢٧٤٣", postal_code: "١٢٢١١" });
  indic.valid && indic.value.building_number === "2743" && indic.value.postal_code === "12211"
    ? pass("الأرقامُ الهندية تُطبَّع ولا تُرفض")
    : fail("الأرقامُ الهندية رُفضت أو لم تُطبَّع");

  // الجوّالُ بصيغه الثلاث ⇒ صيغةٌ واحدة. وبلا هذا يصير الرقمُ الواحدُ
  // ثلاثةَ عملاءَ في قائمة منع COD.
  const phones = ["0555000111", "+966555000111", "٠٥٥٥٠٠٠١١١", "966555000111"];
  const normalized = new Set(phones.map((p) => normalizeSaudiMobile(p)));
  normalized.size === 1 && normalized.has("0555000111")
    ? pass("الجوّالُ يُطبَّع إلى صيغةٍ واحدة مهما كُتب")
    : fail(`صيغُ الجوّال لم توحَّد: ${[...normalized].join(" · ")}`);

  normalizeSaudiMobile("0111234567") === null && normalizeSaudiMobile("") === null
    ? pass("وغيرُ الجوّال السعوديّ يُرفض")
    : fail("رقمٌ غيرُ جوّالٍ سعوديٍّ قُبل");

  // الرمزُ المختصر اختياريٌّ — لكنه إن كُتب فبصيغته
  validateNationalAddress({ ...GOOD, short_address: "" }).valid &&
  !validateNationalAddress({ ...GOOD, short_address: "RRD292" }).valid &&
  validateNationalAddress({ ...GOOD, short_address: "rrrd2929" }).valid
    ? pass("الرمزُ المختصر: يُقبل غيابُه، ويُرفض شكلُه الخاطئ")
    : fail("الرمزُ المختصر لا يُفحص كما يجب");

  // 🔴 وكلُّ الأخطاء تُعاد لا أوّلُها — وإلا أرسل العميلُ خمسَ مرّات
  const empty = validateNationalAddress({});
  !empty.valid && empty.errors.length >= 9
    ? pass(`عنوانٌ فارغٌ يُعيد ${empty.errors.length} خطأً دفعةً واحدة`)
    : fail("الأخطاءُ لا تُعاد مجتمعة");

  // والتركيبُ ثم القراءة يعودان بنفس القيمة — الاتجاهُ واحدٌ ولا يُشتقّ
  // المهيكلُ من الملصق.
  {
    const built = toMedusaAddress((validateNationalAddress(GOOD) as any).value);
    const back = (built.metadata as any).national_address;
    back.district === "العليا" && back.additional_number === "6889" && built.address_1 === "2743 طريق الملك فهد"
      ? pass("التركيبُ يحفظ المهيكلَ ويبني الملصق")
      : fail(`التركيبُ أفسد الحقول: ${JSON.stringify(built)}`);
  }


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

  /**
   * عنوانٌ وطنيٌّ صالح — **يُركَّب بدالّة الإنتاج نفسِها**.
   *
   * ولا يُكتب هنا بخطّ اليد: لو كُتب، لاختلف شكلُ `metadata` عمّا يكتبه
   * `POST /store/carts/:id/address`، فتمرّ البوّابةُ على شكلٍ لا وجودَ
   * له في الإنتاج — وهو أسوأ من ألّا تُفحص.
   */
  const gateAddress = (() => {
    const check = validateNationalAddress({
      first_name: "بوّابة",
      last_name: "زادم",
      phone: "0555000111",
      building_number: "2743",
      street: "طريق الملك فهد",
      district: "العليا",
      city: "الرياض",
      postal_code: "12211",
      additional_number: "6889",
    });
    if (!check.valid) {
      throw new Error(`[zadim] عنوانُ البوّابة نفسُه غيرُ صالح: ${JSON.stringify(check.errors)}`);
    }
    return toMedusaAddress(check.value);
  })();

  const newCart = async (qty = 2, withAddress = true) => {
    const { result } = await createCartWorkflow(container).run({
      input: {
        region_id: region.id,
        sales_channel_id: channel.id,
        currency_code: "sar",
        email: "gate@zadim.test",
        shipping_address: withAddress
          ? (gateAddress as any)
          : {
              // عنوانٌ «غربيٌّ» بلا حقولنا — وهو ما يكتبه مسارُ Medusa
              // العامّ، وما كانت تكتبه شاشتُنا قبل هذه الدفعة.
              first_name: "بلا",
              last_name: "عنوانٍ وطنيّ",
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

    // ── ٠) بلا عنوانٍ وطنيٍّ ⇒ يُرفض قبل إنشاء الطلب ─────────────
    //
    // 🔴 هذا الفحصُ هو الذي كان غائباً، وغيابُه ترك المتجرَ ينشئ طلباتٍ
    // **لا تُشحن**: الشاشةُ تجمع العنوانَ وتتركه في المتصفّح، وبوّابةُ
    // الإتمام كانت تبني السلّةَ بعنوانٍ عبر سيرِ العمل — فتفحص الخادمَ
    // لا الواجهة، وتمرّ خضراءَ على متجرٍ لا يعرف أين يُرسل شيئاً.
    //
    // ويُقاس بعدّ الطلبات لا بقراءة الردّ: رفضٌ يُعيد رسالةً ويُنشئ
    // الطلبَ خلفها أسوأُ من قبولٍ صريح.
    logger.info("== بلا عنوانٍ وطنيٍّ ⇒ يُرفض قبل إنشاء الطلب ==");

    const cartNoAddr = await newCart(1, false);
    createdCarts.push(cartNoAddr);
    const beforeAddr = await countOrders();
    const addrOut = await runCheckout(container, cartNoAddr, `gate-addr-${Date.now()}`);
    const afterAddr = await countOrders();

    addrOut.status === 400 && (addrOut.body as any).error?.code === "ADDRESS_REQUIRED"
      ? pass("عنوانٌ بلا حقولٍ وطنية ⇒ ADDRESS_REQUIRED")
      : fail(`المتوقّع ADDRESS_REQUIRED ووصل ${addrOut.status} ${JSON.stringify(addrOut.body)}`);

    afterAddr === beforeAddr
      ? pass(`ولا طلبَ أُنشئ (${beforeAddr} ⇐ ${afterAddr})`)
      : fail(`أُنشئ طلبٌ رغم الرفض: ${beforeAddr} ⇐ ${afterAddr}`);

    // وشاهدٌ موجب: نفسُ السلّة بعنوانٍ وطنيٍّ كاملٍ **تمرّ** — وإلا فالفحصُ
    // يثبت أن شيئاً يمنع، لا أن الذي يمنع هو العنوان.
    const cartOk = await newCart(1, true);
    createdCarts.push(cartOk);
    const okOut = await runCheckout(container, cartOk, `gate-addr-ok-${Date.now()}`);
    okOut.status === 201
      ? pass("والشاهدُ الموجب: نفسُ السلّة بعنوانٍ كاملٍ تمرّ")
      : fail(`سلّةٌ بعنوانٍ كاملٍ رُفضت: ${okOut.status} ${JSON.stringify(okOut.body).slice(0, 200)}`);

    // ── ٠ب) 🔴 سعرٌ لا تقسمه الضريبةُ صحيحاً ⇒ يجب أن يُشترى ─────
    //
    // قِيس في 2026-09-04 أن منتجاً سعرُه **٩٩٫٩٩ ريالاً** كان لا يُشترى
    // من هذا المتجر إطلاقاً: ضريبةُ ١٥٪ عليه ١٨٧٤٫٨٥ هللة، فالمجموعُ
    // كسريّ، وعمودُ العرض `integer` يقرّبه عند الكتابة — ثم يُقارَن
    // المقرَّبُ بالكسريّ فيختلفان **في كل محاولة**. حلقةٌ لا تنتهي،
    // ورسالتُها «تغيّر سعرُك» ولم يتغيّر شيء.
    //
    // ولم تمسكه بوّابةٌ من خمسَ عشرة لأن ضريبةَ ١٥٪ تُنتج هللةً صحيحةً
    // **فقط إن كان المبلغُ من مضاعفات العشرين** — وسعرا البذرة كلاهما
    // كذلك صدفةً. فالفحصُ هنا يختار سعراً **ليس** من مضاعفاتها عمداً:
    // بذرةٌ «مريحة» تُخفي عطباً في كل متجرٍ حقيقيّ.
    logger.info("== سعرٌ ذو ضريبةٍ كسرية ⇒ يُشترى ==");

    const FRACTIONAL_PRICE = 9999; // ٩٩٫٩٩ ريالاً — أشهرُ شكلِ سعرٍ في التجزئة
    await setPrice(FRACTIONAL_PRICE);

    // شاهدٌ موجب على أن الفحصَ ليس أعمى: الضريبةُ على هذا السعر كسريّةٌ
    // فعلاً. ولو صارت البذرةُ يوماً بسعرٍ مريحٍ لصار الفحصُ يمرّ بلا أن
    // يفحص شيئاً — وهذا يمنعه.
    const fracCart = await newCart(1, true);
    createdCarts.push(fracCart);
    const { data: fracRows } = await query.graph({
      entity: "cart",
      fields: ["id", "tax_total", "total"],
      filters: { id: fracCart },
    });
    const liveTotal = Number((fracRows[0] as any)?.total ?? 0);
    Number.isInteger(liveTotal)
      ? fail(`الشاهدُ الموجب سقط: المجموعُ الحيُّ ${liveTotal} صحيحٌ بالهللة — فالسعرُ المختار لا يُنتج كسراً ولا يفحص شيئاً`)
      : pass(`الشاهدُ الموجب: المجموعُ الحيُّ كسريٌّ فعلاً (${liveTotal})`);

    // 🔴 **والعرضُ أوّلاً — وإلا فالفحصُ أعمى.**
    //
    // حارسُ المجموع في `orchestrate.ts` مشروطٌ بـ`if (quote && …)`: بلا
    // عرضٍ مخزَّنٍ لا مقارنةَ ولا رفض. فبوّابةٌ تنادي الإتمامَ وحدَه
    // تمرّ خضراءَ على العطب نفسِه (قِيس: مرّت بعد نزع الإصلاح).
    // والعميلُ يرى العرضَ دائماً قبل أن يؤكّد — فهذا مسارُه لا ذاك.
    const fracQuote = await runQuote(container, fracCart);
    fracQuote.status === 201
      ? pass("وعرضُ السلّة سُجِّل قبل التأكيد — كما يفعل العميل")
      : fail(`تعذّر تسجيلُ العرض: ${fracQuote.status} ${JSON.stringify(fracQuote.body).slice(0, 160)}`);

    const beforeFrac = await countOrders();
    const fracOut = await runCheckout(container, fracCart, `gate-frac-${Date.now()}`);
    const afterFrac = await countOrders();

    fracOut.status === 201
      ? pass(`سعرٌ ${FRACTIONAL_PRICE} هللة (${(FRACTIONAL_PRICE / 100).toFixed(2)} ريال) يُشترى`)
      : fail(
          `سعرٌ عاديٌّ لا يُشترى: ${fracOut.status} ${JSON.stringify(fracOut.body).slice(0, 220)}`
        );
    afterFrac === beforeFrac + 1
      ? pass(`وأُنشئ طلبٌ واحدٌ فعلاً (${beforeFrac} ⇐ ${afterFrac})`)
      : fail(`عددُ الطلبات لم يزدْ واحداً: ${beforeFrac} ⇐ ${afterFrac}`);

    // ── ٠ج) وضجيجُ التقريب لا يمنع بيعاً ─────────────────────────
    //
    // إصلاحُ ADR-034 كان يمكن أن يستبدل عائقاً بعائق: التقريبُ يقع على
    // كلّ مركّبٍ على حدة، و`round(س) + round(ص)` قد لا يساوي
    // `round(س+ص)`. قِيس أن ١٢ تركيبةً من ١٠٥ تفعل ذلك — ومنها هذه
    // بالضبط: منتجٌ ٩٩٫٩٠ وشحنٌ ١٩٫٩٩ ⇒ `11489 + 2299 = 13788` بينما
    // `round(total) = 13787`.
    //
    // فصار التوازنُ يُفحص على **الخام** حيث هو ثابتٌ حسابيٌّ يصحّ
    // بالضبط، لا على المقرَّب حيث يقيس الضجيج. والتسامحُ يبقى صفراً.
    // (نُقض: بإعادة الفحص إلى المقرَّب يُرفض هذا البيعُ بـTOTALS_MISMATCH
    // وفرقُه هللةٌ واحدة.)
    logger.info("== تقريبٌ يفترق بهللة ⇒ لا يمنع البيع ==");

    const shipPriceRow = (
      await pg.raw(
        `select pr."id", pr."amount" from "zadim"."shipping_option_price_set" sops
           join "zadim"."price" pr on pr."price_set_id" = sops."price_set_id"
          where sops."shipping_option_id" = ? and pr."currency_code" = 'sar' limit 1`,
        [shipOption.id]
      )
    ).rows[0];
    const originalShip = Number(shipPriceRow.amount);

    try {
      await pg.raw(`update "zadim"."price" set "amount" = 1999 where "id" = ?`, [shipPriceRow.id]);
      await setPrice(9990);

      const roundCart = await newCart(1, true);
      createdCarts.push(roundCart);
      const { data: rc } = await query.graph({
        entity: "cart",
        fields: ["id", "item_total", "shipping_total", "total"],
        filters: { id: roundCart },
      });
      const rcv: any = rc[0];
      const partsSum =
        Math.round(Number(rcv.item_total ?? 0)) + Math.round(Number(rcv.shipping_total ?? 0));
      const roundedTotal = Math.round(Number(rcv.total ?? 0));

      // شاهدٌ موجب: الفرقُ قائمٌ فعلاً — وإلا فالفحصُ يمرّ بلا أن يفحص.
      partsSum !== roundedTotal
        ? pass(`الشاهدُ الموجب: مجموعُ المقرَّبَين ${partsSum} ≠ المجموعُ المقرَّب ${roundedTotal}`)
        : fail(
            `الشاهدُ الموجب سقط: ${partsSum} = ${roundedTotal} — الأرقامُ المختارةُ لا تُنتج فرقَ تقريبٍ فلا تفحص شيئاً`
          );

      await runQuote(container, roundCart);
      const beforeRound = await countOrders();
      const roundOut = await runCheckout(container, roundCart, `gate-round-${Date.now()}`);
      const afterRound = await countOrders();

      roundOut.status === 201
        ? pass("وفرقُ التقريب لا يمنع البيع")
        : fail(
            `فرقُ تقريبٍ بهللةٍ منع بيعاً: ${roundOut.status} ${JSON.stringify(roundOut.body).slice(0, 220)}`
          );
      afterRound === beforeRound + 1
        ? pass(`وأُنشئ طلبٌ واحد (${beforeRound} ⇐ ${afterRound})`)
        : fail(`عددُ الطلبات لم يزدْ واحداً: ${beforeRound} ⇐ ${afterRound}`);
    } finally {
      // أجرةُ الشحن تُعاد مهما وقع: بوّابةٌ تترك القاعدةَ مغيَّرةً تُفسد
      // ما بعدها وتُظهر عطباً في فحصٍ بريء.
      await pg.raw(`update "zadim"."price" set "amount" = ? where "id" = ?`, [
        originalShip,
        shipPriceRow.id,
      ]);
    }

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

    // 🔴 ونفسُ المفتاح على **سلّةٍ أخرى** ليس إعادةً بل خطأُ مُنادٍ.
    //
    // بلا هذا الفحص يُخدَم صاحبُ السلّة الجديدة بجواب سلّةٍ قديمة:
    // ٢٠٠ ومعرّفُ طلبٍ اشتُري قبل قليل — فيرى تأكيداً لطلبٍ لم يُنشأ،
    // وسلّتُه كما هي. وهو أخطرُ من الرفض لأنه يبدو نجاحاً.
    const cartB2 = await newCart(1);
    createdCarts.push(cartB2);
    await runQuote(container, cartB2);

    const crossed = await runCheckout(container, cartB2, key);
    const beforeCross = await countOrders();

    (crossed.body as any)?.error?.code === "IDEMPOTENCY_KEY_REUSED"
      ? pass("ومفتاحٌ مستعملٌ على سلّةٍ أخرى يُرفض صراحةً — لا يُخدَم بجوابٍ ليس له")
      : fail(`المتوقّع IDEMPOTENCY_KEY_REUSED: ${JSON.stringify(crossed.body)}`);

    (crossed.body as any)?.order?.id === undefined &&
    (await countOrders()) === beforeCross
      ? pass("ولا طلبَ أُنشئ ولا طلبٌ قديمٌ أُعيد في ذاك الرفض")
      : fail("الرفضُ سرّب طلباً");

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
