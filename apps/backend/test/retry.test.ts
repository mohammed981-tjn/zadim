/**
 * اختباراتُ قرار الإعادة — `modules/marketing/retry.ts`.
 *
 * ── والفخُّ الذي تحرسه ───────────────────────────────────────────
 *
 * المزوّدُ المسجِّل يُعيد `queued` **دائماً** (لا حسابَ رسائلَ بعد).
 * فمُعيدٌ يعتبر كلَّ `queued` فشلاً يدور على نفس الرسالة كلَّ دقيقةٍ
 * إلى الأبد، ويملأ دفترَ المحاولات بعشرات الآلاف من الصفوف عن رسالةٍ
 * **لم يفشل إرسالُها أصلاً**.
 *
 * والفارقُ بين «حُجز ولم يُحاوَل» و«حاولنا فقال المزوّدُ إنه استلمها»
 * هو `attempts` وحدَه — **ولا يُقرأ من `status`**.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRetriable,
  nextState,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from "../src/modules/marketing/retry.ts";

const P: RetryPolicy = { max_attempts: 3, retry_after_seconds: 300, is_enabled: true };
const NOW = new Date("2026-09-16T12:00:00.000Z");
const row = (o: Partial<{ status: string; attempts: number; next_attempt_at: Date | string | null }> = {}) => ({
  status: "failed",
  attempts: 0,
  next_attempt_at: null,
  ...o,
});

// ──────────────── هل يُعاد؟ ────────────────

test("🔴 `queued` بمحاولةٍ واحدةٍ لا يُعاد — المزوّدُ استلمها", () => {
  assert.equal(isRetriable(row({ status: "queued", attempts: 0 }), P, NOW), true, "حُجز ولم يُحاوَل");
  assert.equal(isRetriable(row({ status: "queued", attempts: 1 }), P, NOW), false, "والمزوّدُ قال queued");
  assert.equal(isRetriable(row({ status: "queued", attempts: 9 }), P, NOW), false);
});

test("`failed` يُعاد ما دام دون الحدّ — ويتوقّف عنده", () => {
  assert.equal(isRetriable(row({ status: "failed", attempts: 2 }), P, NOW), true);
  assert.equal(isRetriable(row({ status: "failed", attempts: 3 }), P, NOW), false, "بلغَ الحدَّ");
});

test("الحالاتُ النهائيّةُ لا تُعاد", () => {
  for (const status of ["sent", "suppressed", "dead", "أيّ شيءٍ آخر"]) {
    assert.equal(isRetriable(row({ status, attempts: 0 }), P, NOW), false, status);
  }
});

test("سياسةٌ مُطفأةٌ توقف كلَّ إعادة", () => {
  const off: RetryPolicy = { ...P, is_enabled: false };
  assert.equal(isRetriable(row({ status: "failed", attempts: 0 }), off, NOW), false);
});

test("🔴 الموعدُ يُحترم — ولا إعادةَ قبل حلوله", () => {
  // إعادةٌ فوريّةٌ تصطدم بنفس السبب: المزوّدُ الساقطُ قبل ثانيةٍ ساقطٌ الآن.
  const future = new Date(NOW.getTime() + 60_000);
  const past = new Date(NOW.getTime() - 1);
  assert.equal(isRetriable(row({ next_attempt_at: future }), P, NOW), false);
  assert.equal(isRetriable(row({ next_attempt_at: past }), P, NOW), true);
  assert.equal(isRetriable(row({ next_attempt_at: NOW }), P, NOW), true, "اللحظةُ نفسُها حلولٌ");
  assert.equal(isRetriable(row({ next_attempt_at: null }), P, NOW), true, "بلا موعدٍ ⇒ مستحقّ");
  assert.equal(
    isRetriable(row({ next_attempt_at: past.toISOString() }), P, NOW),
    true,
    "والموعدُ يُقبل نصّاً"
  );
});

// ──────────────── ماذا تصير بعد المحاولة؟ ────────────────

test("🔴 الكتمُ قرارُ عميلٍ يُحترم — لا عطلٌ يُطارَد", () => {
  const s = nextState({ status: "failed", suppressed: true }, 1, P, NOW);
  assert.deepEqual(s, { status: "suppressed", next_attempt_at: null });
});

test("`sent` و`queued` نهايتان بلا موعدٍ تالٍ", () => {
  assert.deepEqual(nextState({ status: "sent" }, 1, P, NOW), { status: "sent", next_attempt_at: null });
  assert.deepEqual(nextState({ status: "queued" }, 1, P, NOW), { status: "queued", next_attempt_at: null });
});

test("🔴 بلوغُ الحدّ ⇒ شطبٌ — وإلا حُرق نطاقُ المتجر", () => {
  // طابورٌ يطرق بابَ عنوانٍ لم يعد موجوداً يُحرق النطاقَ عند مزوّدي
  // البريد، وذلك **لا يُستدرَك بإصلاح كود**: السمعةُ تُبنى شهوراً.
  const s = nextState({ status: "failed" }, 3, P, NOW);
  assert.deepEqual(s, { status: "dead", next_attempt_at: null });
  assert.equal(nextState({ status: "failed" }, 4, P, NOW).status, "dead", "وما بعده أيضاً");
});

test("🔴 المهلةُ تتّسع مع رقم المحاولة", () => {
  const first = nextState({ status: "failed" }, 1, P, NOW);
  const second = nextState({ status: "failed" }, 2, P, NOW);
  assert.equal(first.status, "failed");
  assert.equal(first.next_attempt_at!.getTime() - NOW.getTime(), 300_000, "٣٠٠ ثانيةً × ١");
  assert.equal(second.next_attempt_at!.getTime() - NOW.getTime(), 600_000, "× ٢");
});

test("السياسةُ الافتراضيّةُ مذكورةٌ صراحةً لا مبثوثةٌ في الكود", () => {
  assert.deepEqual(DEFAULT_RETRY_POLICY, {
    max_attempts: 3,
    retry_after_seconds: 300,
    is_enabled: true,
  });
});

test("الدورةُ كاملةً: فشلٌ ⇒ فشلٌ ⇒ شطب", () => {
  // وتُقرأ كما يقرؤها من يشخّص طابوراً واقفاً.
  const a = nextState({ status: "failed" }, 1, P, NOW);
  assert.equal(a.status, "failed");
  assert.equal(isRetriable({ status: a.status, attempts: 1, next_attempt_at: a.next_attempt_at }, P, NOW), false, "قبل الموعد");
  const later = new Date(a.next_attempt_at!.getTime());
  assert.equal(isRetriable({ status: a.status, attempts: 1, next_attempt_at: a.next_attempt_at }, P, later), true);

  const b = nextState({ status: "failed" }, 2, P, later);
  assert.equal(b.status, "failed");
  const c = nextState({ status: "failed" }, 3, P, later);
  assert.equal(c.status, "dead");
  assert.equal(isRetriable({ status: "dead", attempts: 3, next_attempt_at: null }, P, later), false);
});
