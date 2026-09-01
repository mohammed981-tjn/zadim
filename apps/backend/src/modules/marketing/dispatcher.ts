/**
 * المُرسِل — **يقرأ صندوقَ الأحداث، ولا يمسح جدولاً**.
 *
 * ── وهذا نصُّ بوّابة المرحلة ١١ ──────────────────────────────────
 *
 * > السلةُ المتروكة · انخفاضُ السعر · عودةُ التوفّر · الشرائح —
 * > **كلُّها من `outbox_events` لا من مهامّ تمسح الجداول**.
 *
 * والفرقُ ليس لفظياً. الماسحُ يقرأ **كلَّ** سلّةٍ في المتجر كل دقيقةٍ
 * ليجد واحدةً استحقّت، فيكبر عبؤه مع نمو المتجر — ويوم يصير المتجرُ
 * كبيراً يصير هو المشكلة. والصندوقُ يقرأ ما استحقّ وحدَه بفهرسٍ على
 * الوقت: عبؤه بحجم العمل لا بحجم المتجر.
 *
 * وأعمقُ من الأداء: الماسحُ **يخمّن** ما وقع من حالةٍ راهنة، والصندوقُ
 * **يقرأ ما وقع** كما كُتب لحظتَه. فسلّةٌ تُركت ثم أُفرغت ثم امتلأت
 * يراها الماسحُ حالةً واحدةً، ويرى الصندوقُ قصّتَها.
 */

export type DueEvent = {
  id: string;
  event: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown> | null;
  occurred_at: Date;
  attempts: number;
};

export type SendPlan = {
  event_id: string;
  channel: "email" | "sms" | "push";
  recipient: string;
  subject: string | null;
  body: string;
  send_key: string;
};

export type TemplateRow = {
  event: string;
  channel: string;
  subject_ar?: string | null;
  subject_en?: string | null;
  body_ar: string;
  body_en?: string | null;
  is_active?: boolean | null;
};

/**
 * مفتاحُ الإرسال — **يُبنى في مكانٍ واحد**.
 *
 * ولو بُني في موضعين لاختلفا يوماً بمسافةٍ أو بترتيبِ حقل، فصار المفتاحُ
 * الذي يمنع التكرار **هو** سببَه.
 */
export function sendKey(eventId: string, channel: string, recipient: string): string {
    return `${eventId}:${channel}:${recipient}`;
}

/**
 * ملءُ القالب. والمتغيّراتُ `{{name}}` — وما لا قيمةَ له **يُحذف**
 * ولا يظهر بقوسيه.
 *
 * ⚠️ رسالةٌ فيها `{{product}}` حرفياً تصل العميلَ فتبدو عطلاً، وهي
 * عطلٌ فعلاً — لكن الأسوأ أن تصل وتبدو مقصودة.
 */
export function fillTemplate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * ما الذي يُرسَل لهذا الحدث؟ — **دالّةٌ خالصةٌ لا تُرسِل شيئاً**.
 *
 * تأخذ الحدثَ والقوالبَ والمستقبِل، وتُعيد خطّةً. والإرسالُ الفعليّ عند
 * المُنادي — فيُختبر القرارُ كلُّه بلا مزوّدٍ ولا شبكة.
 */
export function planSends(
  event: DueEvent,
  templates: TemplateRow[],
  recipient: { email?: string | null; phone?: string | null; locale?: string } | null
): SendPlan[] {
  if (!recipient) return [];

  const locale = recipient.locale === "en" ? "en" : "ar";
  const out: SendPlan[] = [];

  for (const t of templates) {
    if (t.event !== event.event) continue;
    if (t.is_active === false) continue;

    const to =
      t.channel === "sms" ? recipient.phone : t.channel === "email" ? recipient.email : null;

    // **ولا رسالةَ بلا مستقبِل.** وقناةٌ بلا عنوانٍ تُتخطّى صامتةً هنا
    // ولا تُسقط بقيةَ القنوات: من لا بريدَ له قد يكون له جوّال.
    if (!to) continue;

    // واللغةُ ترجع إلى العربية حين تنقص الإنجليزية — **بأصلها لا
    // بفراغ**. ورسالةٌ فارغةٌ أسوأُ من رسالةٍ بلغةٍ أخرى.
    const body = (locale === "en" ? t.body_en : t.body_ar) || t.body_ar;
    const subject = (locale === "en" ? t.subject_en : t.subject_ar) ?? t.subject_ar ?? null;

    const vars = { ...(event.payload ?? {}), event: event.event };

    out.push({
      event_id: event.id,
      channel: t.channel as SendPlan["channel"],
      recipient: to,
      subject: subject ? fillTemplate(subject, vars) : null,
      body: fillTemplate(body, vars),
      send_key: sendKey(event.id, t.channel, to),
    });
  }

  return out;
}
