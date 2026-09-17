import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REDACTED,
  isForbiddenKey,
  queryKeys,
  redact,
  requestId,
  requestLine,
  routeOf,
  scrubText,
} from "../src/modules/observability/log.ts";

/**
 * سطرُ السجلّ — وما لا يُسجَّل.
 *
 * وكلُّ حالةٍ هنا ثمنُها معروف: كلمةُ مرورٍ في سجلٍّ لا تُستدرَك،
 * وسطرٌ مُلفَّقٌ يُفسد كلَّ تحقيقٍ يعتمد على السجلّ، ومسارٌ بمعرّفٍ
 * يجعل التجميعَ مستحيلاً فيصير السجلُّ نصّاً لا بيانات.
 */

describe("معرّفُ الطلب — والواردُ لا يُصدَّق", () => {
  const gen = () => "generated-0000-1111";

  it("يقبل معرّفاً صحيحاً من العميل — فيُوصَل خيطُ بوّابةٍ أمامية", () => {
    assert.equal(requestId("abc12345-DEF_90", gen), "abc12345-DEF_90");
  });

  it("🔴 يرفض ما فيه سطرٌ جديد — وإلا زُرع سطرُ سجلٍّ مُلفَّق", () => {
    const attack = 'abc12345\n{"evt":"http","status":200,"route":"/paid"}';
    assert.equal(requestId(attack, gen), "generated-0000-1111");
  });

  it("يرفض القصيرَ والطويلَ وما فيه مسافةٌ أو رموز", () => {
    assert.equal(requestId("short", gen), "generated-0000-1111");
    assert.equal(requestId("x".repeat(65), gen), "generated-0000-1111");
    assert.equal(requestId("has space", gen), "generated-0000-1111");
    assert.equal(requestId("semi;colon;here", gen), "generated-0000-1111");
  });

  it("ويُولَّد حين لا ترويسةَ أصلاً", () => {
    assert.equal(requestId(undefined, gen), "generated-0000-1111");
    assert.equal(requestId(["abc12345-DEF_90", "second"], gen), "abc12345-DEF_90");
  });
});

describe("أسماءُ الحقول الممنوعة", () => {
  it("تُمسك بالجزء لا بالمطابقة التامّة", () => {
    for (const k of [
      "password",
      "newPassword",
      "user_password_confirm",
      "access_token",
      "refreshToken",
      "authorization",
      "Cookie",
      "api_key",
      "publishableKey",
      "card_number",
      "cvv",
      "iban",
      "webhook_signature",
    ]) {
      assert.equal(isForbiddenKey(k), true, k);
    }
  });

  it("ولا تبتلع البريءَ — وإلا صار السجلُّ نجوماً لا بيانات", () => {
    for (const k of ["order_id", "email", "status", "limit", "offset", "region_id"]) {
      assert.equal(isForbiddenKey(k), false, k);
    }
  });
});

describe("إخفاءُ الأشكال داخل النصوص — الشبكةُ الثانية", () => {
  it("«Bearer …» يُخفى أينما وقع في نصّ خطأ", () => {
    const out = scrubText("فشل النداء: Authorization: Bearer abcdef0123456789xyz");
    assert.equal(out.includes("abcdef0123456789xyz"), false);
    assert.equal(out.includes("Bearer ***"), true);
  });

  it("رمزُ JWT يُميَّز بشكله لا باسم حقله", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig";
    assert.equal(scrubText(`token=${jwt}`).includes(jwt), false);
  });

  it("سلسلةُ ١٦ رقماً تُخفى — بطاقةٌ محتملة", () => {
    assert.equal(scrubText("4111111111111111").includes("4111"), false);
  });

  it("🔴 والطابعُ الزمنيُّ بالمِلّي (١٣ رقماً) **لا** يُخفى", () => {
    // وإلا عَمِي السجلُّ عن معرّفاته هو، وهي في كل سطرٍ من هذا المستودع.
    assert.equal(scrubText("sale=vflash-1789605228199"), "sale=vflash-1789605228199");
  });
});

describe("redact — لما لا نملك شكلَه", () => {
  it("يُخفي بالاسم ويُبقي البقيّة", () => {
    const out = redact({ email: "a@b.c", password: "hunter2", nested: { token: "t" } }) as any;
    assert.equal(out.email, "a@b.c");
    assert.equal(out.password, REDACTED);
    assert.equal(out.nested.token, REDACTED);
  });

  it("لا يسقط على بنيةٍ دوريّة — وسقوطٌ في سطرِ سجلٍّ يُسقط الخادم", () => {
    const a: any = { name: "x" };
    a.self = a;
    assert.doesNotThrow(() => redact(a));
  });

  it("ويحدّ طولَ المصفوفات — سجلٌّ بألفِ عنصرٍ ليس سجلّاً", () => {
    const out = redact(Array.from({ length: 100 }, (_, i) => i)) as unknown[];
    assert.equal(out.length, 20);
  });
});

describe("تطبيعُ المسار — بلا تطبيعٍ لا تجميع", () => {
  it("معرّفُ Medusa يصير «:id»", () => {
    assert.equal(routeOf("/admin/orders/order_01M2PCDKWQEHFWE98MGB70QJ27"), "/admin/orders/:id");
  });

  it("وUUID ورقمٌ صريح كذلك", () => {
    assert.equal(
      routeOf("/admin/x/3f2504e0-4f89-11d3-9a0c-0305e82c3301/y"),
      "/admin/x/:id/y"
    );
    assert.equal(routeOf("/store/products/42"), "/store/products/:n");
  });

  it("ولا يُشوّه الثابت — وإلا ضاع المسارُ نفسُه", () => {
    assert.equal(routeOf("/admin/flash-sales"), "/admin/flash-sales");
    assert.equal(routeOf("/"), "/");
  });
});

describe("مفاتيحُ الاستعلام — الأسماءُ تُسجَّل والقيمُ لا", () => {
  it("تُقرأ الأسماءُ وحدَها", () => {
    assert.deepEqual(queryKeys("?limit=20&offset=40&q=هاتف"), ["limit", "offset", "q"]);
  });

  it("والاسمُ الممنوع يُخفى هو أيضاً — فوجودُه وحدَه يدلّ", () => {
    assert.deepEqual(queryKeys("?token=abc&limit=1"), [REDACTED, "limit"]);
  });

  it("ولا شيءَ بلا استعلام", () => {
    assert.deepEqual(queryKeys(""), []);
  });
});

describe("سطرُ الطلب", () => {
  const fields = {
    request_id: "r-1",
    method: "POST",
    route: "/admin/orders/:id",
    status: 403,
    duration_ms: 12,
    actor_id: "usr_1",
    actor_type: "user",
    ip: "1.2.3.4",
    query_keys: ["limit"],
  };

  it("سطرُ JSON واحدٌ يُحلَّل", () => {
    const parsed = JSON.parse(requestLine(fields));
    assert.equal(parsed.evt, "http");
    assert.equal(parsed.status, 403);
    assert.equal(parsed.route, "/admin/orders/:id");
  });

  it("وترتيبُ المفاتيح ثابتٌ لا يتبع ترتيبَ الإدخال", () => {
    const a = requestLine(fields);
    const b = requestLine({
      query_keys: ["limit"],
      ip: "1.2.3.4",
      actor_type: "user",
      actor_id: "usr_1",
      duration_ms: 12,
      status: 403,
      route: "/admin/orders/:id",
      method: "POST",
      request_id: "r-1",
    });
    assert.equal(a, b);
  });

  it("🔴 ولا حقلَ للجسم أصلاً — فلا كلمةَ مرورٍ تصل السجلَّ ولو سُلّمت", () => {
    const line = requestLine({ ...fields, ...({ body: { password: "hunter2" } } as any) });
    assert.equal(line.includes("hunter2"), false);
    assert.equal(line.includes("body"), false);
  });

  it("ورمزُ الخطأ يُضاف حين يوجد وحدَه", () => {
    assert.equal(JSON.parse(requestLine(fields)).error_code, undefined);
    assert.equal(
      JSON.parse(requestLine({ ...fields, error_code: "PRICE_CHANGED" })).error_code,
      "PRICE_CHANGED"
    );
  });
});
