import { MedusaService } from "@medusajs/framework/utils";
import { CodPolicy, CodRefusal, MoneyOperation } from "./models";
import { codEligibility, customerKey, type CodDecision, type CodPolicyInput } from "./cod";

/**
 * خدمةُ المدفوعات: سياسةُ COD ورفضاتُه، وحارسُ تكرار العمليات المالية.
 *
 * ولا تنادي مزوّداً ولا تُحرّك مالاً: التحريكُ عند Medusa وسيرِ عمله.
 * هذه تجيب سؤالين لا يجيبهما: **«هل يُسمح بـCOD لهذا الطلب؟»**
 * و**«هل نُفِّذت هذه العملية من قبل؟»**
 */
class PaymentsModuleService extends MedusaService({
  CodPolicy,
  CodRefusal,
  MoneyOperation,
}) {
  /** السياسةُ النافذة — صفٌّ واحد. وغيابُه يعني **منعاً لا سماحاً**. */
  async policy(): Promise<CodPolicyInput | null> {
    const [row] = await this.listCodPolicies({}, { take: 1 });
    if (!row) return null;
    return {
      is_enabled: (row as any).is_enabled,
      max_order_total: (row as any).max_order_total,
      min_order_total: (row as any).min_order_total,
      refusals_before_block: (row as any).refusals_before_block,
      excluded_cities: (row as any).excluded_cities,
    };
  }

  async refusalsFor(key: string): Promise<number> {
    if (!key) return 0;
    const [, count] = await this.listAndCountCodRefusals({ customer_key: key });
    return count;
  }

  /** الحكمُ الكامل: سياسةٌ + رفضاتٌ + قيمةُ الطلب + المدينة. */
  async codDecision(args: {
    order_total: number;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
  }): Promise<CodDecision & { customer_key: string; refusals: number }> {
    const key = customerKey({ phone: args.phone, email: args.email });
    const [policy, refusals] = await Promise.all([this.policy(), this.refusalsFor(key)]);
    const decision = codEligibility({
      policy,
      order_total: args.order_total,
      city: args.city,
      refusals,
    });
    return { ...decision, customer_key: key, refusals };
  }

  key(input: { phone?: string | null; email?: string | null }): string {
    return customerKey(input);
  }

  // ── حارسُ التكرار على المال ──────────────────────────────────
  //
  // نفسُ نمط ADR-014: يُدرَج المفتاحُ أوّلاً فيصطدم الثاني بالقيد داخل
  // القاعدة. والفحصُ-ثم-الكتابة يمرّ عليهما كليهما.
  async claim(key: string, kind: "capture" | "refund" | "void", ctx: {
    payment_id?: string | null;
    order_id?: string | null;
    amount: number;
  }) {
    const existing = await this.listMoneyOperations({ idempotency_key: key });
    if (existing.length) return { fresh: false, op: existing[0] };

    try {
      const [op] = await this.createMoneyOperations([
        {
          idempotency_key: key,
          kind,
          payment_id: ctx.payment_id ?? null,
          order_id: ctx.order_id ?? null,
          amount: ctx.amount,
          status: "in_progress",
        },
      ]);
      return { fresh: true, op };
    } catch {
      const [op] = await this.listMoneyOperations({ idempotency_key: key });
      return { fresh: false, op };
    }
  }

  async settle(
    id: string,
    outcome:
      | { status: "completed"; result: Record<string, unknown> }
      | { status: "failed"; error_code: string; result: Record<string, unknown> }
  ) {
    await this.updateMoneyOperations({
      id,
      status: outcome.status,
      result: outcome.result,
      error_code: outcome.status === "failed" ? outcome.error_code : null,
    });
  }

  // الرفضةُ واقعةٌ وقعت. وتعديلُها أو حذفُها يُبطل السياسةَ المبنيّةَ
  // عليها — ومن يريد الصفحَ يرفع العتبةَ لا يمحو التاريخ.
  updateCodRefusals = async (): Promise<never> => {
    throw new Error("[zadim] رفضةٌ وقعت لا تُعدَّل. ارفع العتبةَ في السياسة بدل محو التاريخ.");
  };

  deleteCodRefusals = async (): Promise<never> => {
    throw new Error("[zadim] رفضةٌ وقعت لا تُحذف.");
  };
}

export default PaymentsModuleService;
