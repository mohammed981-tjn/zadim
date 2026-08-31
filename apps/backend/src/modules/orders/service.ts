import { MedusaService } from "@medusajs/framework/utils";
import { InvoiceChange, OrderTransition, OutboxEvent } from "./models";
import {
  allowedTargets,
  checkTransition,
  terminalStates,
  type TransitionCheck,
  type TransitionRule,
} from "./transitions";

/**
 * خدمةُ الطلبات: جدولُ الانتقالات، وصندوقُ الأحداث، وسجلُّ الفاتورة.
 *
 * ── وما ليس فيها عمداً: `transitionOrder()` التي تكتب ───────────
 *
 * الوثيقة تقول «لا `UPDATE orders SET status` في أي مكانٍ سوى دالّةٍ
 * واحدة»، وتقترح فحصَ ذلك **بقاعدة lint**. وقاعدةُ lint تحرس ما نكتبه
 * نحن، ولا ترى سيرَ عمل Medusa نفسَه — وهو من يُلغي الطلبات فعلاً — ولا
 * سكربتَ استيراد، ولا `psql`.
 *
 * فالحارسُ **مُطلِقٌ في القاعدة** يقرأ نفسَ هذا الجدول: يمنع الانتقالَ
 * الممنوع مهما كان مصدرُ الكتابة، ويكتب الحدثَ في نفس المعاملة. وهذه
 * الخدمةُ تقرأ وتشرح وتُظهر — ولا تنفرد بالحراسة.
 */
class OrdersModuleService extends MedusaService({
  OrderTransition,
  OutboxEvent,
  InvoiceChange,
}) {
  /** الانتقالاتُ النشطة، جاهزةً للدوالّ الخالصة. */
  async rules(): Promise<TransitionRule[]> {
    const rows = await this.listOrderTransitions({ is_active: true });
    return rows.map((r: any) => ({
      from_status: r.from_status,
      to_status: r.to_status,
      requires_no_shipment: r.requires_no_shipment,
      is_active: r.is_active,
    }));
  }

  check(
    from: string,
    to: string,
    rules: TransitionRule[],
    ctx?: { has_shipment?: boolean }
  ): TransitionCheck {
    return checkTransition(from, to, rules, ctx);
  }

  targets(from: string, rules: TransitionRule[]): string[] {
    return allowedTargets(from, rules);
  }

  terminal(all: string[], rules: TransitionRule[]): string[] {
    return terminalStates(all, rules);
  }

  /** الأحداثُ التي لم تُسلَّم بعد — الأقدمُ أوّلاً. */
  async pendingEvents(limit = 100) {
    return this.listOutboxEvents(
      { delivered_at: null },
      { order: { occurred_at: "ASC" }, take: limit }
    );
  }

  async markDelivered(id: string) {
    await this.updateOutboxEvents({ id, delivered_at: new Date() });
  }

  async markFailed(id: string, error: string, attempts: number) {
    await this.updateOutboxEvents({ id, attempts: attempts + 1, last_error: error });
  }

  // ── ما وقع لا يُعاد كتابتُه ───────────────────────────────────
  //
  // القاعدةُ تمنع تعديلَ حقول الواقعة بمُطلِق، وهذا يمنعه **في الكود**
  // بخطأٍ صريح: من ينادي `updateOutboxEvents` بحمولةٍ جديدة يعرف خطأه في
  // الاختبار لا بعد سنةٍ حين يكتشف أن تعديلاته لم تُحفظ.
  //
  // ولا يُمنع `updateOutboxEvents` كلُّه: `delivered_at` و`attempts`
  // يُكتبان مراراً — فذاك دفترُ المحاولات لا دفترُ الوقائع.
  deleteOutboxEvents = async (): Promise<never> => {
    throw new Error("[zadim] صندوقُ الأحداث يُلحَق ولا يُحذف.");
  };

  deleteInvoiceChanges = async (): Promise<never> => {
    throw new Error("[zadim] سجلُّ تغيّرات الفاتورة يُلحَق ولا يُحذف.");
  };

  updateInvoiceChanges = async (): Promise<never> => {
    throw new Error("[zadim] سجلُّ تغيّرات الفاتورة يُلحَق ولا يُعدَّل.");
  };
}

export default OrdersModuleService;
