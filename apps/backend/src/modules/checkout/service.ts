import { MedusaService } from "@medusajs/framework/utils";
import { CartQuote, CheckoutAttempt } from "./models";
import {
  fingerprint,
  priceDrift,
  totalsBalance,
  totalsOf,
  rawTotalsOf,
  type CartLine,
  type PriceDrift,
  type Totals,
} from "./pricing";

export type QuoteInput = {
  cart: any;
  lines: CartLine[];
};

/**
 * خدمةُ الإتمام: العروضُ والمحاولات.
 *
 * ولا تقرأ سلّةً ولا سعراً بنفسها — تأخذهما معطىً. فالمنطقُ الذي يقرّر
 * «تغيّر السعر» يُختبر بصفوفٍ مكتوبةٍ بخطّ اليد، بلا سلّةٍ ولا منتجٍ
 * ولا قاعدة.
 */
class CheckoutModuleService extends MedusaService({ CartQuote, CheckoutAttempt }) {
  /** يحفظ ما رآه العميل. والعرضُ الأحدثُ يبطل ما قبله. */
  async recordQuote(input: QuoteInput) {
    const t = totalsOf(input.cart);
    const [quote] = await this.createCartQuotes([
      {
        cart_id: input.cart.id,
        currency_code: t.currency_code,
        item_total: t.item_total,
        shipping_total: t.shipping_total,
        tax_total: t.tax_total,
        discount_total: t.discount_total,
        total: t.total,
        items_fingerprint: fingerprint(input.lines),
        // `model.json()` يُشتقّ نوعُه كائناً، والمصفوفةُ JSON صالحةٌ
        // تماماً — والقالبُ هنا يقول ذلك للمترجم لا يُخفي خطأً.
        lines: input.lines as unknown as Record<string, unknown>,
      },
    ]);
    return quote;
  }

  /** آخرُ عرضٍ لم يُستهلك. */
  async latestQuote(cartId: string) {
    const quotes = await this.listCartQuotes(
      { cart_id: cartId, consumed_at: null },
      { order: { created_at: "DESC" }, take: 1 }
    );
    return quotes[0] ?? null;
  }

  async consumeQuote(id: string) {
    await this.updateCartQuotes({ id, consumed_at: new Date() });
  }

  drift(lines: CartLine[], currentPrices: Map<string, number | null | undefined>): PriceDrift[] {
    return priceDrift(lines, currentPrices);
  }

  fingerprint(lines: CartLine[]): string {
    return fingerprint(lines);
  }

  totalsOf(cart: any): Totals {
    return totalsOf(cart);
  }

  /** الخامُ بلا تقريب — للتوازن وحدَه (انظر `rawTotalsOf`). */
  rawTotalsOf(cart: any): Totals {
    return rawTotalsOf(cart);
  }

  balance(t: Totals) {
    return totalsBalance(t);
  }

  /**
   * يحجز المفتاح، ويُعيد المحاولةَ السابقة إن وُجدت.
   *
   * والحجزُ **إدراجٌ يصطدم بقيدٍ فريد** لا فحصٌ ثم كتابة: بين الفحص
   * والكتابة يمرّ الضغطُ الثاني.
   */
  async claimKey(key: string, cartId: string) {
    const existing = await this.listCheckoutAttempts({ idempotency_key: key });
    if (existing.length) return { fresh: false, attempt: existing[0] };

    try {
      const [attempt] = await this.createCheckoutAttempts([
        { idempotency_key: key, cart_id: cartId, status: "in_progress" },
      ]);
      return { fresh: true, attempt };
    } catch (e) {
      // اصطدم بالقيد ⇒ سبقنا أحدٌ بجزءٍ من الثانية.
      const [attempt] = await this.listCheckoutAttempts({ idempotency_key: key });

      // ⚠️ **وإن لم يكن تصادماً فلا محاولةَ تُعاد.** كان `catch` يبتلع
      // كلَّ خطأ ثم يُعيد `attempt` غيرَ معرَّفة، فيسقط المُنادي على
      // `attempt.cart_id` بـ`TypeError` — خمسمئةٌ غامضةٌ في **أخطر
      // نداءٍ في النظام**، ورسالتُها تشير إلى سطرٍ لا علاقةَ له بالسبب.
      // فالسببُ الأصليّ يُرمى كما هو: عطلُ قاعدةٍ يُقرأ عطلَ قاعدة.
      if (!attempt) throw e;

      return { fresh: false, attempt };
    }
  }

  async finishAttempt(
    id: string,
    result:
      | { status: "completed"; order_id: string; response: Record<string, unknown> }
      | { status: "failed"; error_code: string; response: Record<string, unknown> }
  ) {
    await this.updateCheckoutAttempts({
      id,
      status: result.status,
      order_id: result.status === "completed" ? result.order_id : null,
      error_code: result.status === "failed" ? result.error_code : null,
      response: result.response,
    });
  }
}

export default CheckoutModuleService;
