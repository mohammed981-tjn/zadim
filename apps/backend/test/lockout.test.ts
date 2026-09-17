import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lockVerdict,
  loginTarget,
  normalizeIdentity,
  validate,
  warningFor,
  type LockoutPolicyRow,
} from "../src/modules/access/lockout-rules.ts";

/**
 * إقفالُ الحساب — المنطقُ الخالص.
 *
 * وكلُّ حالةٍ هنا ثمنُها معروف: تطبيعٌ ناقصٌ يُضاعف حدَّ المهاجم بحرفٍ
 * كبير، وعدُّ مسارِ التسجيل يقفل حساباً على صاحبه، ومهلةٌ تُحسب من
 * أوّل فشلٍ تُفرج عن المهاجم وهو ما زال يجرّب.
 */

const POLICY: LockoutPolicyRow = {
  actor_type: "customer",
  window_seconds: 900,
  max_failures: 5,
  lock_seconds: 600,
};

const NOW = new Date("2026-09-17T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("تطبيعُ الهويّة", () => {
  it("🔴 حالةُ الحرف لا تصنع حساباً ثانياً", () => {
    assert.equal(normalizeIdentity("A@B.Co"), "a@b.co");
    assert.equal(normalizeIdentity("  a@b.co  "), "a@b.co");
  });

  it("والفارغُ يبقى فارغاً — فلا يُعدّ طلبٌ بلا بريد", () => {
    assert.equal(normalizeIdentity(undefined), "");
    assert.equal(normalizeIdentity(null), "");
  });
});

describe("هل هو طلبُ دخول؟", () => {
  it("مسارُ الدخول يُعرَف بنوعِ فاعله", () => {
    assert.deepEqual(loginTarget("/auth/customer/emailpass", { email: "A@b.co" }), {
      identity_key: "a@b.co",
      actor_type: "customer",
    });
    assert.deepEqual(loginTarget("/auth/user/emailpass", { email: "s@z.co" }), {
      identity_key: "s@z.co",
      actor_type: "user",
    });
  });

  it("🔴 ومسارُ التسجيل **لا يُعدّ** — وإلا قُفل حسابٌ على صاحبه", () => {
    // من نسي أن له حساباً فحاول التسجيل يفشل بـ«البريد مستعمل»،
    // وعدُّ ذلك يقفل حسابَه هو.
    assert.equal(loginTarget("/auth/customer/emailpass/register", { email: "a@b.co" }), null);
  });

  it("وما ليس تحت /auth ليس منه", () => {
    assert.equal(loginTarget("/store/carts", { email: "a@b.co" }), null);
    assert.equal(loginTarget("/auth/vendor/emailpass", { email: "a@b.co" }), null);
  });

  it("وطلبٌ بلا بريدٍ لا هويّةَ له فلا يُعدّ", () => {
    assert.equal(loginTarget("/auth/customer/emailpass", {}), null);
    assert.equal(loginTarget("/auth/customer/emailpass", null), null);
  });
});

describe("الحكم", () => {
  it("دون السقف: يمرّ", () => {
    assert.deepEqual(lockVerdict(POLICY, { count: 4, last_at: ago(10) }, NOW), {
      locked: false,
    });
  });

  it("عند السقف: يُقفل — والحدُّ عند بلوغه لا بعده", () => {
    const v = lockVerdict(POLICY, { count: 5, last_at: ago(10) }, NOW);
    assert.equal(v.locked, true);
    assert.equal((v as any).retry_after_seconds, 590);
  });

  it("🔴 والمهلةُ من **آخر** فشل — فمن يواصل يمدّد إقفالَه بنفسه", () => {
    const early = lockVerdict(POLICY, { count: 9, last_at: ago(599) }, NOW);
    assert.equal((early as any).retry_after_seconds, 1);
    const fresh = lockVerdict(POLICY, { count: 9, last_at: ago(0) }, NOW);
    assert.equal((fresh as any).retry_after_seconds, 600);
  });

  it("وبعد انقضاء المدّة يُفرَج ولو بقي العدُّ عالياً", () => {
    assert.deepEqual(lockVerdict(POLICY, { count: 99, last_at: ago(601) }, NOW), {
      locked: false,
    });
  });

  it("🔴 ولا سياسةَ ⇒ لا إقفال — فشلٌ مفتوحٌ بقصد", () => {
    // جدولٌ مفقودٌ يجب ألّا يمنع الناسَ من الدخول إلى متجرهم.
    assert.deepEqual(lockVerdict(null, { count: 1000, last_at: NOW }, NOW), {
      locked: false,
    });
  });

  it("وعدٌّ بلا تاريخٍ لا يقفل — صفٌّ ناقصٌ لا يحرم أحداً", () => {
    assert.deepEqual(lockVerdict(POLICY, { count: 50, last_at: null }, NOW), {
      locked: false,
    });
  });
});

describe("تحقّقُ المسار الإداريّ", () => {
  const good = {
    actor_type: "customer" as const,
    window_seconds: 900,
    max_failures: 20,
    lock_seconds: 900,
  };

  it("الصحيحُ يمرّ", () => {
    assert.equal(validate(good), null);
  });

  it("ونوعُ فاعلٍ لا نعرفه يُرفض", () => {
    assert.notEqual(validate({ ...good, actor_type: "vendor" as any }), null);
  });

  it("والأصفارُ والسوالبُ والكسورُ تُرفض بأسمائها", () => {
    for (const k of ["window_seconds", "max_failures", "lock_seconds"] as const) {
      for (const v of [0, -1, 1.5]) {
        const msg = validate({ ...good, [k]: v });
        assert.notEqual(msg, null, `${k}=${v}`);
        assert.equal(msg!.includes(k), true, `${k}=${v} لم يُسمَّ في الرسالة`);
      }
    }
  });
});

describe("تنبيهُ الضبط — يُقال لحظتَه لا بعد شكوى", () => {
  it("سقفٌ ضيّقٌ يُنبَّه عليه", () => {
    assert.notEqual(warningFor({ max_failures: 3, window_seconds: 900, lock_seconds: 900 }), null);
  });

  it("وإقفالٌ يتجاوز يوماً يُنبَّه عليه — فهو سلاحٌ ضدّ الضحية", () => {
    assert.notEqual(
      warningFor({ max_failures: 20, window_seconds: 900, lock_seconds: 90000 }),
      null
    );
  });

  it("والمعقولُ لا يُنبَّه عليه — وتنبيهٌ دائمٌ لا يُقرأ", () => {
    assert.equal(warningFor({ max_failures: 20, window_seconds: 900, lock_seconds: 900 }), null);
  });
});
