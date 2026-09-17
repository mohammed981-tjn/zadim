/**
 * قواعدُ إقفال الحساب — **منطقٌ خالصٌ بلا استيرادٍ واحد**.
 *
 * ── ولماذا ملفٌّ منفصلٌ عن الوسيط ────────────────────────────────
 *
 * لأن اختباراتِ الوحدة تعمل بمُجرِّد Node مباشرةً على TypeScript
 * (`node --test`)، وهو يحلّ المساراتِ **بلاحقتها** لا كما يفعل
 * `tsc`. فملفٌّ يستورد إطارَ العمل لا يُختبَر إلا بقاعدةٍ وخادمٍ
 * كاملَين — وحينها لا يُختبَر أبداً.
 *
 * فالقاعدةُ هنا كما في `permission-map.ts`: **القرارُ في ملفٍّ خالص،
 * والقاعدةُ والشبكةُ في غيره.**
 */

export type LockoutPolicyRow = {
  actor_type: "user" | "customer";
  window_seconds: number;
  max_failures: number;
  lock_seconds: number;
};

export type LockVerdict =
  | { locked: false }
  | { locked: true; retry_after_seconds: number };

/** الهدفُ من طلبِ دخول — أو `null` فليس طلبَ دخولٍ أصلاً. */
export type LoginTarget = {
  identity_key: string;
  actor_type: "user" | "customer";
};

/**
 * تطبيعُ الهويّة — وبدونه يُجرَّب الحسابُ أضعافَ الحدّ.
 *
 * `A@b.co` و`a@b.co` حسابان في نظر أيّ عدٍّ نصّيّ، وهما حسابٌ واحدٌ
 * عند تسجيل الدخول. فبلا تطبيعٍ يُضاعف المهاجمُ حدَّه بتغيير حالةِ
 * حرفٍ واحد — ولا يظهر ذلك في أيّ سجلّ.
 */
export function normalizeIdentity(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * هل هذا طلبُ دخول؟ — ومسارُ التسجيل ليس منه.
 *
 * مسارات Medusa: `/auth/:actor/:provider` دخولاً،
 * و`/auth/:actor/:provider/register` تسجيلاً. والثاني **لا يُعدّ**:
 * فشلُه «البريدُ مستعمل» لا «كلمةٌ خاطئة»، وعدُّه يقفل حساباً قائماً
 * كلَّما حاول صاحبُه التسجيلَ ناسياً أن له حساباً.
 */
export function loginTarget(pathname: string, body: unknown): LoginTarget | null {
  const seg = pathname.split("?")[0].split("/").filter(Boolean);
  if (seg.length !== 3 || seg[0] !== "auth") return null;
  const actor = seg[1];
  if (actor !== "user" && actor !== "customer") return null;

  const email = normalizeIdentity((body as any)?.email);
  if (!email) return null;
  return { identity_key: email, actor_type: actor };
}

/**
 * الحكمُ من العدّ — دالّةٌ خالصةٌ تُختبَر بلا قاعدة.
 *
 * والإقفالُ يُحسب من **آخر** فشلٍ لا من أوّله: من يواصل التخمين
 * يُمدّد إقفالَه بنفسه، ومن توقّف يُفرج عنه بعد المدّة.
 */
export function lockVerdict(
  policy: LockoutPolicyRow | null,
  failures: { count: number; last_at: Date | null },
  now: Date
): LockVerdict {
  if (!policy) return { locked: false };
  if (failures.count < policy.max_failures) return { locked: false };
  if (!failures.last_at) return { locked: false };

  const until = failures.last_at.getTime() + policy.lock_seconds * 1000;
  const remainingMs = until - now.getTime();
  if (remainingMs <= 0) return { locked: false };
  return { locked: true, retry_after_seconds: Math.ceil(remainingMs / 1000) };
}


/** ما يصل من المسار الإداريّ — والتحقّقُ يقرؤه لا يثق به. */
export type PolicyBody = {
  actor_type?: "user" | "customer";
  window_seconds?: number;
  max_failures?: number;
  lock_seconds?: number;
  enabled?: boolean;
};

/**
 * التحقّقُ — **مُصدَّرٌ لتفحصه البوّابة بلا شبكة**.
 *
 * والقيدُ في القاعدة أيضاً (`check`)، وهذا لا يُغنيه: القاعدةُ تردّ
 * خطأً بلغةِ Postgres، وهذا يردّ جملةً عربيةً يفهمها من يضبط.
 */
export function validate(body: PolicyBody): string | null {
  if (body.actor_type !== "user" && body.actor_type !== "customer") {
    return "نوعُ الفاعل «user» أو «customer».";
  }
  for (const key of ["window_seconds", "max_failures", "lock_seconds"] as const) {
    const v = Number((body as any)[key]);
    if (!Number.isInteger(v) || v <= 0) return `«${key}» عددٌ صحيحٌ أكبرُ من صفر.`;
  }
  return null;
}

/**
 * تنبيهُ الضبط — يُقال **لحظةَ الضبط** لا بعد شكوى.
 *
 * وسببُه أن الرقمَ الضيّقَ يبدو أماناً وهو قد يكون العطب: ثلاثُ
 * محاولاتٍ تقفل حسابَ من نسي كلمتَه، والدعمُ يصير طابوراً.
 */
export function warningFor(p: {
  max_failures: number;
  window_seconds: number;
  lock_seconds: number;
}): string | null {
  if (p.max_failures <= 3) {
    return (
      `سقفُ ${p.max_failures} محاولاتٍ ضيّقٌ: من نسي كلمتَه يجرّب ثلاثاً عادةً، ` +
      "فقد تُقفل حساباتِ عملاءَ لم يهاجمهم أحد."
    );
  }
  if (p.lock_seconds > 24 * 3600) {
    return (
      "مدّةُ الإقفال تتجاوز يوماً: ومن عرف بريدَ عميلٍ يستطيع أن يحرمه " +
      "الدخولَ يوماً كاملاً بإفشالِ الدخول عمداً."
    );
  }
  return null;
}
