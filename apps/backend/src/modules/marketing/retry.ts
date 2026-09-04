/**
 * قرارُ الإعادة — **دالّتان خالصتان لا تلمسان قاعدةً ولا شبكة**.
 *
 * لأن السؤالين اللذين يقرّران مصيرَ رسالةٍ («هل تُعاد؟» و«ماذا تصير
 * بعد هذه المحاولة؟») يجب أن يُختبرا بلا مزوّدٍ ولا مؤقّت. والخلطُ
 * بينهما وبين نداءِ القاعدة هو ما يجعل منطقَ الطوابير غيرَ مُختبَرٍ في
 * أكثر المشاريع.
 */

export type RetryPolicy = {
  max_attempts: number;
  retry_after_seconds: number;
  is_enabled: boolean;
};

export type RetriableSend = {
  status: string;
  attempts: number;
  next_attempt_at: Date | string | null;
};

export type AttemptOutcome = {
  status: "sent" | "queued" | "failed";
  provider?: string;
  error?: string;
  suppressed?: boolean;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 3,
  retry_after_seconds: 300,
  is_enabled: true,
};

/**
 * هل يُعاد هذا الصفّ الآن؟
 *
 * ── وحالتان فقط تُعادان — والثالثةُ هي الفخّ ────────────────────
 *
 * | الحالة | يُعاد؟ | لماذا |
 * |---|---|---|
 * | `failed` ومحاولاتُه دون الحدّ | نعم | فشلٌ حقيقيّ يستحقّ محاولةً |
 * | `queued` و`attempts = 0` | نعم | حُجز **ولم يُحاوَل قطّ** — سقوطٌ بين الحجز والإرسال |
 * | `queued` و`attempts ≥ 1` | **لا** | **المزوّدُ نفسُه قال queued** |
 * | `sent` · `suppressed` · `dead` | لا | نهائيّة |
 *
 * 🔴 والصفُّ الثالثُ هو الذي يُغفَل فيُكلِّف: المزوّدُ المسجِّل يُعيد
 * `queued` **دائماً** (لا حسابَ رسائلَ بعد). فمُعيدٌ يعتبر كلَّ
 * `queued` فشلاً يدور على نفس الرسالة كلَّ دقيقةٍ إلى الأبد — ويملأ
 * دفترَ المحاولات بعشرات الآلاف من الصفوف عن رسالةٍ لم يفشل إرسالُها
 * أصلاً. والفارقُ بين «حُجز ولم يُحاوَل» و«حاولنا فقال المزوّدُ إنه
 * استلمها» هو `attempts` وحدَه، ولا يُقرأ من `status`.
 */
export function isRetriable(
  row: RetriableSend,
  policy: RetryPolicy,
  now: Date = new Date()
): boolean {
  if (!policy.is_enabled) return false;

  const due =
    row.next_attempt_at === null || new Date(row.next_attempt_at).getTime() <= now.getTime();
  if (!due) return false;

  if (row.status === "failed") return row.attempts < policy.max_attempts;
  if (row.status === "queued") return row.attempts === 0;
  return false;
}

/**
 * ماذا تصير الحالةُ بعد محاولةٍ نتيجتُها هذه؟
 *
 * ⚠️ و`attemptNo` هو الرقمُ الذي **كتبته القاعدة** لا حسابُ التطبيق:
 * الشطبُ قرارٌ يُبنى على عدد المحاولات، وعددٌ يحسبه الكودُ ينحرف عن
 * الدفتر أوّلَ مرّةٍ يسقط فيها بينهما.
 *
 * والمهلةُ تتّسع: `retry_after_seconds × attemptNo`. وإعادةٌ فوريّةٌ
 * تصطدم بنفس السبب — المزوّدُ الساقطُ قبل ثانيةٍ ساقطٌ الآن.
 */
export function nextState(
  outcome: AttemptOutcome,
  attemptNo: number,
  policy: RetryPolicy,
  now: Date = new Date()
): { status: "sent" | "queued" | "failed" | "suppressed" | "dead"; next_attempt_at: Date | null } {
  // قرارُ عميلٍ يُحترم — لا عطلٌ يُطارَد، ولا إعادة.
  if (outcome.suppressed) return { status: "suppressed", next_attempt_at: null };

  if (outcome.status === "sent") return { status: "sent", next_attempt_at: null };

  // المزوّدُ استلمها وهو صاحبُها الآن. ولا تُعاد: `attempts` صار ≥ ١.
  if (outcome.status === "queued") return { status: "queued", next_attempt_at: null };

  // 🔴 بلغَ الحدَّ ⇒ يُشطب. ولولا الشطبُ لظلّ الطابورُ يطرق بابَ عنوانٍ
  // لم يعد موجوداً حتى يُحرَق نطاقُ المتجر عند مزوّدي البريد — وذلك
  // لا يُستدرَك بإصلاح كود، لأن السمعةَ تُبنى شهوراً.
  if (attemptNo >= policy.max_attempts) return { status: "dead", next_attempt_at: null };

  return {
    status: "failed",
    next_attempt_at: new Date(now.getTime() + policy.retry_after_seconds * attemptNo * 1000),
  };
}
