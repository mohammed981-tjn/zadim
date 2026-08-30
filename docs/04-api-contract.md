# ٤) عقود الواجهات

> [ADR-003](00-decisions.md): **خادمُ تجارةٍ واحد، والقنواتُ كلُّها
> زبائنُ له.** فلا منطقَ عملٍ في الواجهة أبداً — السعرُ والضريبةُ
> والخصمُ والمخزون تُحسب في الخادم وحده، والواجهةُ تعرض ولا تحسب.
>
> **اختبارُ العقد**: لو بنينا تطبيق جوالٍ غداً، كم سطراً نكتب في
> الخادم؟ **صفر.**

---

## ٠) القواعد العامّة

| القاعدة | التفصيل |
|---|---|
| **الجذور الثلاثة** | `/store/*` للعميل · `/admin/*` للوحة · `/ops/*` للمستودع |
| **المصادقة** | العميل: JWT · اللوحة: جلسة + دور · القنوات: `X-Api-Key` مربوطٌ بقناة |
| **القناة إلزامية** | كلُّ نداءٍ في `/store` يحمل `X-Channel` — الطلبُ يعرف من أين جاء |
| **المال** | كلُّ مبلغٍ عددٌ صحيح بالهللات + `currency_code`. **لا كسورَ في JSON** |
| **اللغة** | `Accept-Language: ar` افتراضاً، والردُّ يحمل الحقلَ المطلوب لا الاثنين |
| **الترقيم** | `?limit=&cursor=` — بالمؤشّر لا بالإزاحة. `OFFSET 100000` يمسح مئة ألف صف |
| **التكرار** | كلُّ نداءٍ يكتب مالاً يقبل `Idempotency-Key`. الشبكةُ تسقط والعميل يعيد، **ولا يُحصَّل مرتين** |
| **الأخطاء** | شكلٌ واحد: `{ "error": { "code", "message_ar", "details" } }` |

### رموز الأخطاء — معدودةٌ لا مرتجَلة

| الرمز | متى |
|---|---|
| `OUT_OF_STOCK` | نفد بين إضافته للسلة وإتمام الطلب |
| `PRICE_CHANGED` | تغيّر السعر منذ آخر عرضٍ للسلة |
| `COUPON_INVALID` · `COUPON_EXHAUSTED` · `COUPON_ALREADY_USED` | ثلاثةٌ مفصولة — «كوبونٌ غير صالح» لا تكفي العميل |
| `PAYMENT_DECLINED` · `PAYMENT_TIMEOUT` | |
| `ADDRESS_UNSERVICEABLE` | لا ناقلَ يغطّي المنطقة |
| `TRANSITION_NOT_ALLOWED` | انتقالُ حالةٍ ممنوع ([`03`](03-state-machines.md)) |
| `INSUFFICIENT_PERMISSION` · `LIMIT_EXCEEDED` | الثاني حين يتجاوز الفاعلُ حدَّه (استردادٌ فوق سقف الدعم) |

---

## ١) `/store` — واجهة العميل

### الكتالوج

| الطريقة | المسار | ملاحظة |
|---|---|---|
| `GET` | `/store/products` | `?category=&brand=&q=&filters[color]=&sort=&cursor=` |
| `GET` | `/store/products/:slug` | المنتج بمتغيّراته وخياراته ووسائطه وسعرِ كلِّ متغيّر ومتاحِه |
| `GET` | `/store/categories/:slug/filters` | **الفلاترُ تأتي من الخادم** — مولَّدةً من خصائص التصنيف (بند ٣) |
| `GET` | `/store/search?q=` | يمرّ بمحرّك البحث مع تطبيع العربية ([ADR-006](00-decisions.md)) |
| `GET` | `/store/home` | **كتلُ الصفحة مرتَّبةً من CMS** (بند ٣٧) — الواجهةُ ترسم ما يصلها ولا تعرف الترتيب |

**`GET /store/products/:slug` — ما يعيده لكل متغيّر:**
```jsonc
{
  "variants": [{
    "id": "…", "sku": "IPH-15-BLK-256",
    "options": { "اللون": "أسود", "السعة": "٢٥٦ج" },
    "price":       { "amount": 429900, "currency": "SAR" },
    "compare_at":  { "amount": 469900, "currency": "SAR" },
    "availability": "in_stock",     // in_stock · low_stock · out_of_stock
    "low_stock_threshold_hit": true // «بقي ٣ فقط» — بلا كشف الرقم الدقيق
  }]
}
```
> **لا يُكشف المخزونُ الدقيق للعميل.** «متوفّر» و«بقي القليل» و«نفد» —
> ثلاثُ حالاتٍ لا رقم. كشفُ الرقم يخدم المنافسَ أكثرَ من المشتري.

### السلة و Checkout

| الطريقة | المسار |
|---|---|
| `POST` | `/store/carts` · `POST /store/carts/:id/items` · `PATCH`/`DELETE .../items/:itemId` |
| `POST` | `/store/carts/:id/coupon` — يرجع الخصمَ محسوباً أو `COUPON_*` |
| `POST` | `/store/carts/:id/shipping-options` — الخياراتُ **للعنوان المُعطى**، بأسعارها من `shipping_rates` |
| `POST` | **`/store/carts/:id/checkout`** |

**🔴 `checkout` هو أخطر نداءٍ في النظام**، وترتيبُه ملزم:

```
١. أعِد قراءة الأسعار من المصدر     ← لا من السلة
٢. أعِد التحقّق من المخزون          ← السلة عمرُها ساعات
٣. أعِد حساب الضريبة والشحن والخصم
٤. اختر المستودع/المستودعات         ← الأقربُ الذي يُتمّ الطلب كلَّه
٥. احجز المخزون (معاملةٌ واحدة)     ← فشلُها يُلغي كلَّ ما قبلها
٦. أنشئ الطلب مُجمَّدَ البنود
٧. أنشئ جلسة الدفع
```

فإن تغيّر شيءٌ بين عرض السلة والإتمام: `PRICE_CHANGED` أو
`OUT_OF_STOCK` **قبل أخذ المال**، مع الفرق معروضاً. والعميلُ يقرّر.

### الحساب والطلبات

| الطريقة | المسار | ملاحظة |
|---|---|---|
| `GET` | `/store/orders` · `/store/orders/:id` | |
| `GET` | `/store/orders/:id/tracking` | أحداثُ التتبّع (بند ١٨) |
| `POST` | `/store/orders/:id/returns` | البنودُ والسببُ والصور |
| `GET`/`POST`/`PATCH` | `/store/addresses` | بحقول العنوان الوطني |
| `GET`/`POST`/`DELETE` | `/store/wishlist` | |
| `POST` | `/store/reviews` | **يُرفض إن لم يكن `order_item_id` للعميل** — قيدٌ في القاعدة ✅ مُختبَر |
| `GET` | `/store/loyalty` | الرصيدُ مجموعُ القيود، والشريحةُ والتاريخ |

**الضيف** (بند ٨): كلُّ ما سبق يعمل بـ`cart_id` بلا حساب. وبعد الطلب
يُعرض «أنشئ حساباً لتتابع طلبك» — والحسابُ يرث الطلبَ بمطابقة الجوال.

---

## ٢) `/admin` — مركز القيادة

| المجال | المسارات |
|---|---|
| **اللوحة** | `GET /admin/dashboard?compare=yesterday\|last_month` — بند ٢٩ |
| **المنتجات** | CRUD + `POST /admin/products/bulk` · `/import` · `/export` (بندا ٣٠-٣١) |
| **المخزون** | `GET /admin/inventory` · `POST /admin/inventory/adjust` · `/transfer` · `/stocktake` |
| **الطلبات** | `GET /admin/orders` · `POST /admin/orders/:id/cancel` · `/refund` · `/fulfil` |
| **الشحن** | CRUD على `shipping_zones` · `shipping_options` · `shipping_rates` · `carriers` |
| **العروض** | CRUD على `promotions` · `coupons` · `flash_sales` |
| **المرتجعات** | `POST /admin/returns/:id/approve` · `/reject` · `/refund` |
| **المحتوى** | `GET/PUT /admin/pages/:slug/blocks` — **الترتيبُ سحبٌ وإفلات** |
| **الشراء** | CRUD على `suppliers` · `purchase_orders` + `POST /:id/receive` |
| **المالية** | `GET /admin/reports/sales` · **`/margin`** · `/settlements` |
| **النظام** | `users` · `roles` · `settings` · **`GET /admin/audit`** |

**كلُّ نداءٍ في `/admin`**: يفحص الصلاحية من
[`05-rbac-matrix.md`](05-rbac-matrix.md)، **ويكتب `audit_logs` بقيمةٍ
قبل وبعد** إن كان يغيّر.

**`POST /admin/orders/:id/refund`** — أدقُّها:
```jsonc
{
  "amount": 15000,          // هللات
  "kind": "items",
  "reason": "صنفٌ تالف",     // إلزاميّ (بند ٢٠)
  "restock": false          // قرارٌ صريح لا افتراضيّ
}
```
> يُرفض بـ`LIMIT_EXCEEDED` إن تجاوز سقفَ دور الفاعل. والسقفُ **إعدادٌ
> لا ثابت**.

---

## ٣) `/ops` — تشغيل المستودع

واجهةٌ منفصلةٌ عمداً: تُستعمل من جهازٍ كفّيّ بماسحٍ ضوئيّ داخل المستودع،
لا من مكتب.

| الطريقة | المسار | ملاحظة |
|---|---|---|
| `GET` | `/ops/pick-lists?location=&state=` | |
| `GET` | `/ops/pick-lists/:id` | البنودُ **مرتَّبةً بمسار المشي** لا برقم البند |
| `POST` | `/ops/pick-lists/:id/scan` | `{ barcode, quantity }` |
| `POST` | `/ops/pick-lists/:id/complete` | **يُرفض إن نقص بند** |
| `POST` | `/ops/fulfilments/:id/pack` | `{ packages: [{ barcode, weight_grams, box_type }] }` |
| `POST` | `/ops/fulfilments/:id/label` | يُنشئ البوليصة عبر محوّل الناقل |
| `POST` | `/ops/fulfilments/:id/ship` | ⇒ يُطلق `FulfilmentShipped` ⇒ **يُحصَّل الدفع** |
| `POST` | `/ops/returns/:id/receive` · `/inspect` | الفحصُ قرارٌ بشريّ |
| `POST` | `/ops/purchase-orders/:id/receive` | ⇒ يزيد المخزون آلياً (بند ٣٣) |

**`POST /ops/pick-lists/:id/scan` — الماسحُ يتحقّق ولا يثق** (بند ١٥):

| الحالة | الردّ |
|---|---|
| الباركود مطابق | `{ "ok": true, "picked_qty": 2, "remaining": 0 }` |
| **باركودٌ لا يخصّ هذه القائمة** | `{ "error": { "code": "WRONG_ITEM" } }` — **ويتوقّف اللقط** |
| الكمية أكثر من المطلوب | `{ "error": { "code": "QUANTITY_EXCEEDED" } }` |

---

## ٤) Webhooks الواردة

| المصدر | المسار | الحارس |
|---|---|---|
| مزوّد الدفع | `POST /hooks/payments/:provider` | **توقيعٌ يُتحقَّق منه — وإلا زوّر أيٌّ كان دفعةً ناجحة** |
| الناقل | `POST /hooks/carriers/:carrier` | نفسه |
| ZATCA | `POST /hooks/zatca` | نفسه |

**وكلُّها لا تُغيّر الحالة مباشرةً**: تكتب حدثاً في `outbox_events`،
والنطاقُ المالك يقرّر ([`03`](03-state-machines.md) §٥). فويبهوك مكرَّرٌ
أو خارجُ الترتيب لا يفسد حالةَ طلب.

---

## ٥) ما يُوثَّق آلياً

عقدُ الواجهات يُولَّد **من الكود** بـOpenAPI، لا يُكتب يدوياً — الوثيقةُ
اليدوية تتقادم في أول أسبوع. وهذا الملف يصف **المبادئ والحدود**؛
والمرجعُ التنفيذيّ يُولَّد في المرحلة ١.
