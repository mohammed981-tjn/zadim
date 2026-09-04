import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  refreshCartItemsWorkflow,
} from "@medusajs/medusa/core-flows";
import { CHECKOUT_MODULE } from "./index";
import type CheckoutModuleService from "./service";
import { WAREHOUSE_MODULE } from "../warehouse";
import type WarehouseModuleService from "../warehouse/service";
import { PAYMENTS_MODULE } from "../payments";
import type PaymentsModuleService from "../payments/service";
import { amount } from "./pricing";
import { cartLines, currentPrices, readCart } from "./cart-reader";
import { readNationalAddress } from "./national-address";

/**
 * ترتيبُ الإتمام السبعة — **خارجَ المسار عمداً**.
 *
 * ── لماذا هنا لا في `route.ts` ──────────────────────────────────
 *
 * البوّابة تقول «يُرفض **قبل أخذ المال**»، وذاك ثابتٌ يجب أن يُختبر في
 * CI في كل دفعة. ومنطقٌ يسكن مُعالِجَ مسارٍ لا يُختبر إلا بخادمٍ يعمل
 * ومنفذٍ مفتوح — فيصير الاختبارُ ثقيلاً، ثم يُشطب من CI، ثم يُنسى.
 *
 * فالمنطقُ هنا يأخذ الحاويةَ ويُعيد `{ status, body }`، والمسارُ سطران.
 * والفحصُ الحيُّ بـ`curl` يبقى — لكنه يفحص **طبقة النقل** لا المنطق.
 */

export type Outcome = { status: number; body: Record<string, unknown> };

/**
 * مُعرِّفُ مزوّد الدفع عند الاستلام.
 *
 * وشكلُه `pp_<identifier>_<id>` اصطلاحُ Medusa: `identifier` من
 * `cod-payment/service.ts` و`id` من `medusa-config.ts`. فتغييرُ أيّهما
 * يغيّر هذا — ولذلك يُكتب ثابتاً واحداً هنا، ويقابله فحصٌ في
 * `verify-payments.ts` يتأكّد أن المزوّدَ بهذا الاسم **مسجَّلٌ فعلاً**
 * في الحاوية. وإلا فأوّلُ ما يكشف الخطأ عميلٌ لا يستطيع الشراء.
 */
export const COD_PROVIDER_ID = "pp_cod_cod";

const err = (
  status: number,
  code: string,
  message_ar: string,
  details?: unknown
): Outcome => ({
  status,
  body: { error: { code, message_ar, ...(details === undefined ? {} : { details }) } },
});

// ────────────────────────────────────────────────────────────────
// العرض
// ────────────────────────────────────────────────────────────────

/**
 * يعيد التسعيرَ من المصدر ثم يثبّت **ما رآه العميل**.
 *
 * وإعادةُ التسعير هنا ليست ترفاً بل **بابُ القبول**: قِيس أن Medusa
 * يجمّد سعرَ السطر عند الإضافة ولا يُحدّثه أبداً — لا عند القراءة ولا
 * عند `refreshCartItems` ولا عند الإتمام. فلولا بابٌ يقبل فيه العميلُ
 * السعرَ الجديد لصارت السلّةُ التي تغيّر سعرُها **مرفوضةً إلى الأبد**،
 * والحارسُ مصيدة.
 */
export async function runQuote(scope: any, cartId: string): Promise<Outcome> {
  const checkout = scope.resolve(CHECKOUT_MODULE) as CheckoutModuleService;

  const cart = await readCart(scope, cartId);
  if (!cart) return err(404, "CART_NOT_FOUND", "لا سلّةَ بهذا المعرّف.");
  if (cart.completed_at) return err(409, "CART_COMPLETED", "هذه السلّة أُتمّت من قبل.");

  let lines = cartLines(cart);
  if (!lines.length) return err(400, "CART_EMPTY", "السلّةُ فارغة — لا شيءَ يُعرض سعرُه.");

  const prices = await currentPrices(scope, cart);
  const stale = checkout.drift(lines, prices);
  const repriceable = stale.filter((d: any) => prices.get(d.variant_id) !== null);

  if (repriceable.length) {
    const cartModule = scope.resolve(Modules.CART);
    await cartModule.updateLineItems(
      repriceable.map((d: any) => ({ id: d.line_id, unit_price: d.current_unit_price })) as any
    );
    // والضريبةُ والخصمُ يُعادان بعده: مجموعٌ بضريبةِ السعر القديم على
    // سعرٍ جديد رقمٌ لا يوازن شيئاً.
    await refreshCartItemsWorkflow(scope).run({ input: { cart_id: cartId } });
  }

  const priced = (await readCart(scope, cartId)) ?? cart;
  lines = cartLines(priced);

  // متغيّرٌ لا سعرَ له الآن لا يُباع بسعرٍ قديمٍ محفوظٍ في سلّة.
  const unpriced = checkout
    .drift(lines, prices)
    .filter((d: any) => prices.get(d.variant_id) === null);
  if (unpriced.length) {
    return err(
      409,
      "PRICE_UNAVAILABLE",
      "بعضُ الأصناف لم يعُد لها سعرٌ معروض. احذفها من السلّة ثم أعِد المحاولة.",
      { lines: unpriced.map((u: any) => ({ variant_id: u.variant_id, title: u.title })) }
    );
  }

  const quote = await checkout.recordQuote({ cart: priced, lines });

  return {
    status: 201,
    body: {
      quote: {
        id: quote.id,
        cart_id: quote.cart_id,
        currency_code: quote.currency_code,
        item_total: quote.item_total,
        shipping_total: quote.shipping_total,
        tax_total: quote.tax_total,
        discount_total: quote.discount_total,
        total: quote.total,
        created_at: quote.created_at,
      },
    },
  };
}

// ────────────────────────────────────────────────────────────────
// الإتمام
// ────────────────────────────────────────────────────────────────

/**
 * `١` أعِد قراءة الأسعار من المصدر · `٢` أعِد التحقّق من المخزون ·
 * `٣` أعِد الحساب · `٤` اختر المستودع · `٥` احجز · `٦` أنشئ الطلب ·
 * `٧` أنشئ جلسة الدفع.
 *
 * والخطوةُ ١ **لا يفعلها Medusa إطلاقاً** (قِيس). والخطوةُ ٥ يفعلها
 * تحت قفل، ويرفض بالإنجليزية كاشفاً معرّفاتِ المستودعات — فتُترجَم
 * هنا إلى `OUT_OF_STOCK` برسالةٍ عربية، والعميلُ لا يُعرض له أيُّ
 * مستودعٍ نفد.
 */
export async function runCheckout(
  scope: any,
  cartId: string,
  idempotencyKey?: string | null
): Promise<Outcome> {
  const checkout = scope.resolve(CHECKOUT_MODULE) as CheckoutModuleService;
  const warehouse = scope.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  // ── ٠) التكرار: مفتاحٌ واحدٌ ⇒ طلبٌ واحد ───────────────────────
  const key = (idempotencyKey ?? "").trim() || null;
  let attemptId: string | null = null;

  if (key) {
    const { fresh, attempt } = await checkout.claimKey(key, cartId);
    if (!fresh) {
      // 🔴 **المفتاحُ يعيد جوابَ نفسِ الطلب، لا جوابَ أيّ طلب.**
      //
      // كان الإعادةُ تُبنى على المفتاح وحدَه، والمفتاحُ يُطابَق بلا نظرٍ
      // إلى السلّة. فقِيس على الخادم:
      //
      //   ١) سلّةٌ فارغة + مفتاح K  ⇒  400 CART_EMPTY  (ويُخزَّن)
      //   ٢) سلّةٌ فيها منتج + K    ⇒  409 CART_EMPTY «replayed»
      //
      // سلّةٌ صالحةٌ تُرفض برسالةٍ عن سلّةٍ أخرى — والعميلُ يقرأ «السلّةُ
      // فارغة» وهو ينظر إلى صنفَيه. والصمتُ أخطر: لو كانت المحاولةُ
      // الأولى **ناجحة** لأُعيد طلبُها (٢٠٠ ومعرّفُ طلبٍ قديم) فيظنّ
      // العميلُ سلّتَه الجديدةَ اشتُريت، ولم تُشترَ.
      //
      // والمفتاحُ يُعرّف **محاولةً واحدةً على سلّةٍ بعينها**؛ فمفتاحٌ
      // بمعاملاتٍ مختلفة خطأُ مُنادٍ يُقال صراحةً، لا يُخدَم بجوابٍ
      // ليس له.
      if (attempt.cart_id !== cartId) {
        return err(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "مفتاحُ الطلب مستعملٌ لسلّةٍ أخرى. حدّث الصفحة ثم أعِد المحاولة."
        );
      }
      if (attempt.status === "in_progress") {
        return err(409, "CHECKOUT_IN_PROGRESS", "طلبُك قيدُ التنفيذ — لا تُعِد الإرسال.");
      }
      return {
        status: attempt.status === "completed" ? 200 : 409,
        body: { ...((attempt.response ?? {}) as object), replayed: true },
      };
    }
    attemptId = attempt.id;
  }

  const finish = async (outcome: Outcome, code: string, orderId?: string): Promise<Outcome> => {
    if (attemptId) {
      await checkout.finishAttempt(
        attemptId,
        orderId
          ? { status: "completed", order_id: orderId, response: outcome.body }
          : { status: "failed", error_code: code, response: outcome.body }
      );
    }
    return outcome;
  };

  const cart = await readCart(scope, cartId);
  if (!cart) {
    return finish(err(404, "CART_NOT_FOUND", "لا سلّةَ بهذا المعرّف."), "CART_NOT_FOUND");
  }
  if (cart.completed_at) {
    return finish(err(409, "CART_COMPLETED", "هذه السلّة أُتمّت من قبل."), "CART_COMPLETED");
  }

  const lines = cartLines(cart);
  if (!lines.length) {
    return finish(err(400, "CART_EMPTY", "السلّةُ فارغة."), "CART_EMPTY");
  }

  // ── ٠ب) العنوانُ الوطنيّ — **قبل كلّ شيءٍ يُكلّف** ─────────────
  //
  // 🔴 الحارسُ الذي كان غائباً، وغيابُه كان يُنتج **طلباتٍ لا تُشحن**.
  //
  // شاشةُ الإتمام كانت تجمع العنوانَ وتتركه في المتصفّح، فيُنشأ الطلبُ
  // بلا عنوانٍ ولا بريد. ولم تكشفه بوّابةٌ واحدة: `verify-checkout.ts`
  // يبني السلّةَ بالعنوان عبر سيرِ العمل فيفحص الخادمَ لا الواجهة،
  // وبوّابةُ المتصفّح لا تزور `/checkout` أصلاً.
  //
  // ⚠️ **ولا يكفي أن يوجد عنوان**: `POST /store/carts/:id` مسارٌ عامٌّ
  // من Medusa يقبل أيَّ عنوانٍ بلا حقولنا. فيُفحص **اكتمالُه** لا
  // حضورُه — والقراءةُ من `metadata.national_address` لا من النصّ
  // المركَّب، فالاتجاهُ واحدٌ ولا يُشتقّ المهيكلُ من الملصق.
  //
  // وموضعُه هنا لا مع بقيّة الحرّاس: هو أرخصُ فحصٍ في الترتيب (قراءةُ
  // حقلٍ مقروءٍ أصلاً)، ورفضُه لا يحتاج تسعيراً ولا مخزوناً. ثم إن
  // خطوةَ COD أدناه تقرأ منه المدينةَ والجوّال — فلا معنى لتشغيلها قبله.
  const national = readNationalAddress(cart.shipping_address);
  if (!national) {
    return finish(
      err(
        400,
        "ADDRESS_REQUIRED",
        "أكملْ بيانات العنوان الوطنيّ قبل تأكيد الطلب — رقمُ المبنى والشارعُ والحيُّ والمدينةُ والرمزُ البريديُّ والرقمُ الإضافيّ."
      ),
      "ADDRESS_REQUIRED"
    );
  }

  // ── ١) الأسعارُ من المصدر ─────────────────────────────────────
  const prices = await currentPrices(scope, cart);
  const drift = checkout.drift(lines, prices);

  if (drift.length) {
    return finish(
      err(
        409,
        "PRICE_CHANGED",
        "تغيّرت أسعارُ بعض الأصناف منذ عرضِ سلّتك. راجع الفرق ثم أعِد المحاولة.",
        { lines: drift }
      ),
      "PRICE_CHANGED"
    );
  }

  // ── ٢) والمجموعُ الذي وافق عليه العميل ────────────────────────
  // فرقُ الأسعار وحده لا يكفي: قد يتغيّر الشحنُ أو الضريبةُ أو ينتهي
  // عرضٌ — والمجموعُ هو ما وافق عليه العميل، لا سعرُ الصنف.
  const quote = await checkout.latestQuote(cartId);
  const totals = checkout.totalsOf(cart);

  if (quote && quote.items_fingerprint === checkout.fingerprint(lines)) {
    if (Number(quote.total) !== totals.total) {
      return finish(
        err(409, "PRICE_CHANGED", "تغيّر مجموعُ سلّتك منذ عرضِه. راجع الفرق ثم أعِد المحاولة.", {
          quoted_total: Number(quote.total),
          current_total: totals.total,
          difference: totals.total - Number(quote.total),
        }),
        "PRICE_CHANGED"
      );
    }
  }

  // ── ٣) توازنُ المجاميع — حارسٌ على أنفسنا ─────────────────────
  // Medusa لا يخزّن المجاميع فلا `CHECK` يحرسها. ومجموعٌ لا يوازن
  // بنودَه يعني أن العميلَ سيُحصَّل رقماً لا يشرحه شيء.
  // 🔴 **على الخام لا على المقرَّب** (ADR-034): المعادلةُ ثابتٌ حسابيٌّ
  // عن أرقام Medusa نفسِها، وفحصُها على أرقامٍ قُرِّب كلٌّ منها على حدة
  // يقيس ضجيجَ التقريب فيمنع بيعاً مشروعاً بهللة.
  const balance = checkout.balance(checkout.rawTotalsOf(cart));
  if (!balance.ok) {
    return finish(
      err(409, "TOTALS_MISMATCH", "تعذّر تأكيدُ مجموع الطلب. لم يُخصم شيء — حاول بعد قليل.", {
        expected: balance.expected,
        got: totals.total,
        diff: balance.diff,
      }),
      "TOTALS_MISMATCH"
    );
  }

  // ── ٣ب) أهليّةُ الدفع عند الاستلام — **قبل الحجز وقبل الطلب** ──
  //
  // 🔴 هذه شرطُ الخطوة ٧ (جلسةُ الدفع) مسحوباً إلى هنا عمداً — والسبعةُ
  // كما هي في `04-api-contract.md`. ولو تُرك في مكانه لحجزنا المخزونَ
  // ثم رفضنا، فيخرج الصنفُ من السوق لعميلٍ لم يشترِ.
  //
  // ⚠️ **و COD هو وسيلةُ الدفع الوحيدة اليوم** (`medusa-config.ts`:
  // مزوّدٌ واحد). فرفضُ الأهليّة رفضٌ للطلب كلِّه لا تحويلٌ إلى وسيلةٍ
  // أخرى — وهذا صحيحٌ لا نقص: ادّعاءُ بدائلَ لا وجودَ لها أسوأ. ويوم
  // يصل مزوّدٌ ثانٍ يصير هذا اختياراً لا بوّابة.
  //
  // وكانت هذه الفحوصُ كلُّها مبنيّةً ومُختبَرةً في المرحلة ٦ (`payments/cod.ts`)
  // **ولا يناديها مسارُ إنتاجٍ واحد**: البوّابةُ تنادي الدالّةَ مباشرةً
  // فتمرّ خضراء، والمتجرُ لا يمرّ بها. فحدُّ المالك ورفضاتُه كانا حبراً.
  const payments = scope.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const cod = await payments.codDecision({
    order_total: totals.total,
    // من العنوان المهيكل لا من حقول Medusa: المدينةُ هناك مطبَّعةٌ
    // مفحوصة، والجوّالُ موحَّدُ الصيغة (`05…`) — ومفتاحُ منع COD يُبنى
    // منه، فصيغتان مختلفتان لرقمٍ واحد تعنيان عميلين في نظر القائمة.
    city: national.city,
    phone: national.phone,
    email: cart.email ?? null,
  });

  if (!cod.eligible) {
    return finish(
      err(409, cod.code, cod.reason_ar),
      cod.code
    );
  }

  // ── ٤) المخزون: فحصٌ مسبقٌ واختيارُ المستودع ─────────────────
  const plan = await allocationFor(scope, warehouse, cart, lines);
  if (plan && !plan.fully_allocatable) {
    const short = plan.unfulfilled.map((u: any) => {
      const line = lines.find((l) => l.variant_id === u.variant_id);
      return { variant_id: u.variant_id, title: line?.title ?? null, short_by: u.quantity };
    });
    return finish(
      err(409, "OUT_OF_STOCK", "نفدت كمّيةُ بعض الأصناف. عدّل سلّتك ثم أعِد المحاولة.", {
        lines: short,
      }),
      "OUT_OF_STOCK"
    );
  }

  // ── ٥+٦+٧) الحجزُ والطلبُ وجلسةُ الدفع ───────────────────────
  try {
    await ensurePayment(scope, cart);

    const { result } = await completeCartWorkflow(scope).run({ input: { id: cartId } });
    const orderId = (result as any)?.id;

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "currency_code", "total"],
      filters: { id: orderId },
    });
    const order = orders[0] as any;

    if (quote) await checkout.consumeQuote(quote.id);

    return finish(
      {
        status: 201,
        body: {
          order: {
            id: order?.id ?? orderId,
            display_id: order?.display_id ?? null,
            currency_code: order?.currency_code ?? cart.currency_code,
            total: amount(order?.total),
          },
          allocation: plan ?? null,
        },
      },
      "OK",
      orderId
    );
  } catch (e: any) {
    const raw = String(e?.message ?? "");

    // 🔴 الحجزُ فشل رغم الفحص المسبق: بِيعَ ما في السلّة لعميلٍ آخر في
    // الثواني بين الفحص والحجز. وهذا **ليس عطلاً** — هو السباقُ الذي
    // من أجله وُضع القفلُ والمُطلِق. والرسالةُ للعميل واحدة.
    const outOfStock = /not enough stock|insufficient stock|بيعٌ زائد/i.test(raw);
    const code = outOfStock ? "OUT_OF_STOCK" : "CHECKOUT_FAILED";
    return finish(
      err(
        409,
        code,
        outOfStock
          ? "نفدت كمّيةُ بعض الأصناف قبل تأكيد طلبك مباشرةً. لم يُخصم شيء."
          : "تعذّر إتمامُ الطلب. لم يُخصم شيء — حاول بعد قليل."
      ),
      code
    );
  }
}

/**
 * خطّةُ الشحن من مستودعات قناة السلّة.
 *
 * وتُعاد `null` حين لا يمكن بناؤها (لا قناةَ أو لا مستودعَ مربوط) —
 * **ولا تُرفض الطلبيةُ حينها**: فحصٌ مسبقٌ تعذّر ليس دليلَ نفاد،
 * والحارسُ الحقيقيُّ هو الحجزُ في الخطوة ٥، ويعمل بلا هذا الفحص.
 */
async function allocationFor(
  scope: any,
  warehouse: WarehouseModuleService,
  cart: any,
  lines: { variant_id: string; quantity: number; title?: string | null }[]
): Promise<any | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const inventory = scope.resolve(Modules.INVENTORY);

  if (!cart.sales_channel_id) return null;

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "stock_locations.id"],
    filters: { id: cart.sales_channel_id },
  });
  const locationIds = ((channels[0] as any)?.stock_locations ?? []).map((l: any) => l.id);
  if (!locationIds.length) return null;

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "manage_inventory", "inventory_items.inventory_item_id"],
    filters: { id: lines.map((l) => l.variant_id) },
  });

  // «لا يُدار مخزونُه» يعني بلا حدّ — ولا يدخل الخطّة أصلاً.
  const itemOf = new Map<string, string | null>();
  for (const v of variants as any[]) {
    const managed = v.manage_inventory !== false;
    itemOf.set(v.id, managed ? v.inventory_items?.[0]?.inventory_item_id ?? null : null);
  }

  const managedLines = lines.filter((l) => itemOf.get(l.variant_id));
  if (!managedLines.length) {
    return { shipments: [], unfulfilled: [], split_count: 0, fully_allocatable: true };
  }

  const levels = await inventory.listInventoryLevels({
    inventory_item_id: managedLines.map((l) => itemOf.get(l.variant_id) as string),
    location_id: locationIds,
  });

  const profiles = await warehouse.listLocationProfiles({});

  const plan = warehouse.planAllocation({
    lines: managedLines.map((l) => ({
      inventory_item_id: itemOf.get(l.variant_id) as string,
      quantity: l.quantity,
    })),
    availability: (levels as any[]).map((l) => ({
      inventory_item_id: l.inventory_item_id,
      location_id: l.location_id,
      available: Number(l.stocked_quantity) - Number(l.reserved_quantity),
    })),
    profiles: (profiles as any[]).map((p) => ({
      location_id: p.location_id,
      city: p.city,
      priority: Number(p.priority),
      is_fulfilment_enabled: p.is_fulfilment_enabled,
    })),
    destination_city: cart.shipping_address?.city ?? null,
  });

  // يُعاد `variant_id` لا `inventory_item_id`: العميلُ يعرف الصنف،
  // ولا يعرف مادةَ مخزونٍ ولا يجب أن يُعرَّف بها.
  const byItem = new Map<string, string>();
  for (const [variantId, itemId] of itemOf) if (itemId) byItem.set(itemId, variantId);

  return {
    ...plan,
    unfulfilled: plan.unfulfilled.map((u) => ({
      variant_id: byItem.get(u.inventory_item_id) ?? u.inventory_item_id,
      quantity: u.quantity,
    })),
  };
}

/**
 * جلسةُ دفعٍ إن لم تكن — **بمزوّد الدفع عند الاستلام**.
 *
 * ── وكان `pp_system_default` — وهو خطأٌ عاش بعد سببه ─────────────
 *
 * كُتب «مؤقّتٌ حتى المرحلة ٦»، ثم اجتازت المرحلةُ ٦ وبقي السطر. فبقي
 * كلُّ طلبٍ يُتمّ بمزوّدٍ **يوافق على كلّ شيءٍ بلا تحصيل**، ومزوّدُ COD
 * المبنيُّ في تلك المرحلة لا يصله نداء. ومعه سقط ما يحرسه:
 * `money_held: false` التي تمنع حسابَ الموعود محصَّلاً، وحارسُ
 * «التحصيلُ بعد الشحن» في القاعدة الذي لا يُنادى إن لم يُنادَ المزوّد.
 *
 * ⚠️ **و«تمّ الطلب» عند COD تعني «التزم العميل»** لا «حُصِّل المال»:
 * المالُ يُقيَّد عند التسليم (`cod-payment/service.ts`). وهذا فرقٌ يجب
 * أن يعرفه من يقرأ تقريراً مالياً، ولذلك تُميَّز بياناتُ الجلسة.
 */
async function ensurePayment(scope: any, cart: any) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: found } = await query.graph({
    entity: "cart",
    fields: ["id", "payment_collection.id", "payment_collection.payment_sessions.id"],
    filters: { id: cart.id },
  });
  const collection = (found[0] as any)?.payment_collection;

  if (collection?.payment_sessions?.length) return;

  const collectionId =
    collection?.id ??
    (await createPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cart.id } }))
      .result.id;

  await createPaymentSessionsWorkflow(scope).run({
    input: { payment_collection_id: collectionId, provider_id: COD_PROVIDER_ID },
  });
}
