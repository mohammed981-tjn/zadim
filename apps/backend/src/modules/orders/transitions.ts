/**
 * آلةُ حالات الطلب — **دالّةٌ خالصة** فوق جدولٍ من البيانات.
 *
 * ── الحالاتُ الستّ التي عند Medusa، لا الخمسُ التي في وثيقتنا ────
 *
 * `03-state-machines.md` يرسم `draft → pending → confirmed →
 * completed`، و`order.status` عند Medusa تعدادٌ ثابت:
 *
 * ```
 * draft · pending · requires_action · completed · canceled · archived
 * ```
 *
 * **وليس فيه `confirmed`.** وإضافةُ قيمةٍ إلى تعدادٍ لا نملكه دَينٌ
 * يُدفع في أوّل ترقية — و`ALTER TYPE … ADD VALUE` لا يُتراجَع عنه.
 *
 * فـ«مؤكَّد» عندنا هو الزوج (`pending` + دفعٌ محصَّل). ولا يضيع شيءٌ من
 * الوثيقة: مطلبُها الأصليّ **فصلُ المحاور** — والمحورُ الماليّ والتنفيذيّ
 * منفصلان أصلاً عند Medusa ويُحسبان من جداولهما.
 */

export type TransitionRule = {
  from_status: string;
  to_status: string;
  requires_no_shipment?: boolean | null;
  is_active?: boolean | null;
};

export type TransitionCheck =
  | { allowed: true; rule: TransitionRule }
  | { allowed: false; code: "TRANSITION_NOT_ALLOWED" | "SHIPMENT_EXISTS"; reason_ar: string };

/**
 * ⚠️ **الانتقالُ إلى النفس ليس انتقالاً**: `pending ⇒ pending` يمرّ بلا
 * فحصٍ ولا حدث. ولولا هذا لَرفض النظامُ أيَّ تحديثٍ لطلبٍ لا يمسّ حالته
 * — لأن المُطلِقَ يرى `old.status = new.status` ويسأل الجدولَ عن انتقالٍ
 * لا وجودَ له.
 */
export function checkTransition(
  from: string,
  to: string,
  rules: TransitionRule[],
  ctx: { has_shipment?: boolean } = {}
): TransitionCheck {
  if (from === to) {
    return { allowed: true, rule: { from_status: from, to_status: to } };
  }

  const rule = rules.find(
    (r) => r.is_active !== false && r.from_status === from && r.to_status === to
  );

  if (!rule) {
    return {
      allowed: false,
      code: "TRANSITION_NOT_ALLOWED",
      reason_ar: `انتقالٌ ممنوع: ${from} ⇐ ${to} ليس في جدول الانتقالات.`,
    };
  }

  if (rule.requires_no_shipment && ctx.has_shipment) {
    return {
      allowed: false,
      code: "SHIPMENT_EXISTS",
      reason_ar:
        "لا يُلغى طلبٌ شُحنت منه شحنة. البضاعةُ خرجت — والطريقُ مرتجعٌ لا إلغاء.",
    };
  }

  return { allowed: true, rule };
}

/** الوجهاتُ الممكنة من حالةٍ ما — لبناء أزرارِ اللوحة من البيانات. */
export function allowedTargets(from: string, rules: TransitionRule[]): string[] {
  return rules
    .filter((r) => r.is_active !== false && r.from_status === from)
    .map((r) => r.to_status)
    .sort();
}

/**
 * الحالاتُ النهائية: لا انتقالَ منها إطلاقاً.
 *
 * وتُحسب من الجدول لا تُكتب يدوياً — قائمةٌ يدويّةٌ تفترق عن الجدول
 * يومَ يُضاف صفّ.
 */
export function terminalStates(all: string[], rules: TransitionRule[]): string[] {
  return all.filter((s) => allowedTargets(s, rules).length === 0).sort();
}
