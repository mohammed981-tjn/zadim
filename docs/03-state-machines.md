# ٣) آلات الحالات

> **القاعدة**: لا انتقالَ إلا وهو في جدولٍ من هذه الجداول. وكلُّ انتقالٍ
> له **مالك** — الحدثُ أو الدورُ الذي يملك إطلاقه. ومحاولةُ انتقالٍ غير
> مذكور تُرفض ولا تُسجَّل نجاحاً.

---

## ٠) لماذا ثلاثةُ أعمدةٍ لا عمودٌ بستّ عشرة حالة

المواصفة (بند ١١) طلبت `order.status` واحداً بستّ عشرة قيمة. وقد
اعترضتُ عليه في [ADR-001](00-decisions.md) — وهذا موضعُ البرهان:

**الحالة التي تكسره**: طلبٌ من ثلاثة أصناف. شُحن صنفان، والثالث نفد
فاستُرِدّ ثمنُه.

| بالعمود الواحد | لماذا يكذب |
|---|---|
| `SHIPPED` | يكذب على المحاسبة: جزءٌ من المال رُدّ |
| `PARTIALLY_REFUNDED` | يكذب على العميل: شحنتُه في الطريق ولا يراها |
| كلاهما معاً | **مستحيل** — العمودُ يحمل قيمةً واحدة |

**بالأعمدة الثلاثة**، الحقيقةُ كاملةٌ بلا تناقض:

```
status            = confirmed
payment_status    = partially_refunded
fulfilment_status = partially_fulfilled
```

**ولا حالةَ من الستّ عشرة ضاعت** — كلُّها تُعبَّر عنها بتركيبة:

| حالةُ المواصفة | التعبيرُ عنها |
|---|---|
| `DRAFT` | `status=draft` |
| `PENDING_PAYMENT` | `status=pending` · `payment=not_paid` |
| `PAID` | `payment=captured` |
| `CONFIRMED` | `status=confirmed` |
| `PROCESSING` · `PICKING` · `PACKING` · `READY_TO_SHIP` | `fulfilments.state` — لأنها صفاتُ **شحنة** لا صفاتُ طلب |
| `SHIPPED` | `fulfilment=fulfilled` + `fulfilments.state=shipped` |
| `OUT_FOR_DELIVERY` · `DELIVERED` | `fulfilments.state` |
| `CANCELLED` | `status=cancelled` |
| `RETURN_REQUESTED` · `RETURNED` | `return_requests.state` · `fulfilment=returned` |
| `REFUNDED` · `PARTIALLY_REFUNDED` | `payment_status` |

**والمكسبُ ليس نظرياً**: تفاصيلُ اللقط والتغليف نزلت إلى `fulfilments`،
فطلبٌ يُشحن من مستودعين له **حالتان مستقلّتان** — واحدةٌ لكل شحنة. وهذا
مستحيلٌ بعمودٍ واحد مهما كثرت قيمُه.

---

## ١) `orders.status` — دورةُ حياة الطلب

```
      ┌─────────┐  checkout   ┌──────────┐  payment ok   ┌───────────┐
      │  draft  │────────────>│ pending  │──────────────>│ confirmed │
      └─────────┘             └──────────┘               └─────┬─────┘
                                    │                          │
                          payment failed /                 كلُّ البنود
                          expired / cancelled              نُفِّذت أو رُدّت
                                    │                          │
                                    ▼                          ▼
                              ┌───────────┐              ┌───────────┐
                              │ cancelled │<─────────────│ completed │
                              └───────────┘   لا رجوع     └───────────┘
```

| من | إلى | المُطلِق | الشرط |
|---|---|---|---|
| `draft` | `pending` | العميل — «أكمل الطلب» | السلة غيرُ فارغة · المخزون متاح · العنوان موجود |
| `pending` | `confirmed` | حدثُ `PaymentCaptured` أو `COD` | **حجزُ المخزون نجح** |
| `pending` | `cancelled` | العميل · انتهاءُ المهلة · فشلُ الدفع | — |
| `confirmed` | `completed` | حدثُ `AllItemsSettled` | `fulfilled_qty + returned_qty = quantity` لكل بند |
| `confirmed` | `cancelled` | `operations` أو `super_admin` **فقط** | **لا شحنةَ شُحنت بعد** · سببٌ إلزاميّ |
| `completed` | — | **لا انتقال** | المكتملُ نهائيّ. والمرتجعُ بعده يعيشُ في `return_requests` لا بإعادة الطلب إلى الوراء |

**🔴 الانتقالان الممنوعان صراحةً**:
- `cancelled → أيّ شيء`. الملغى لا يُحيا. من أراد الطلبَ ثانيةً ينشئ طلباً جديداً.
- `confirmed → cancelled` **بعد شحنِ أيّ شحنة**. الطريقُ عندها **مرتجعٌ لا إلغاء** — فالبضاعة خرجت وتحتاج أن تعود.

---

## ٢) `orders.payment_status` — المحور المالي

```
not_paid ──authorize──> authorized ──capture──> captured
    │                       │                      │
    │                    void/expire          refund(جزئي)
    │                       │                      ▼
    └────fail────> failed ──┘            partially_refunded
                                                   │
                                             refund(الباقي)
                                                   ▼
                                                refunded
```

| من | إلى | المُطلِق | ملاحظة |
|---|---|---|---|
| `not_paid` | `authorized` | مزوّد الدفع | المبلغ محجوزٌ لا محصَّل |
| `authorized` | `captured` | **عند الشحن لا عند الطلب** | ما يُلغى قبل الشحن لا يُحصَّل، فلا استردادَ ولا رسومَ استرداد |
| `captured` | `partially_refunded` | `finance` أو `support` بحدّ | `0 < refunded < captured` |
| `partially_refunded` | `refunded` | نفسهم | `refunded = captured` |
| أيّ حالة | `failed` | المزوّد | يُسجَّل ولا يُمحى |

**الدفعُ عند الاستلام (COD)** يقفز: `not_paid → captured` عند تسليم
المندوب. وهو أشيعُ وسيلةٍ في السوق السعودي — **مزوّدٌ كامل الحقوق لا
استثناء**.

**قيدُ القاعدة يحرس المحور**:
`refunded_amount ≤ captured_amount ≤ authorized_amount` — ثلاثةُ قيود
`CHECK` تجعل «استرداد أكثر مما حُصِّل» **مستحيلاً**، لا «ممنوعاً في
الكود».

---

## ٣) `fulfilments.state` — الشحنة الواحدة

```
pending → picking → picked → packing → packed → ready_to_ship
                                                      │
                                                   shipped
                                                      │
                                             out_for_delivery
                                                      │
                                                  delivered
```

| من | إلى | المالك | الحارس |
|---|---|---|---|
| `pending` | `picking` | `inventory` / موظف المستودع | قائمةُ لقطٍ أُنشئت |
| `picking` | `picked` | الملقِّط | **`picked_qty = quantity` لكل بند** — ولا يمرّ ناقصاً |
| `picked` | `packing` | المغلِّف | — |
| `packing` | `packed` | المغلِّف | طردٌ واحدٌ على الأقل بوزن |
| `packed` | `ready_to_ship` | النظام | **بوليصةٌ صدرت من الناقل** |
| `ready_to_ship` | `shipped` | محوّل الناقل | رقمُ تتبّعٍ موجود ⇒ **يُحصَّل الدفع هنا** |
| `shipped` | `out_for_delivery` → `delivered` | تتبّعُ الناقل | حدثٌ من الناقل لا ضغطةُ مدير |
| أيّ حالةٍ قبل `shipped` | `cancelled` | `operations` | **يُفرَج عن الحجز** |
| `shipped` | `failed` | الناقل | تعذّر التسليم ⇒ يفتح مرتجعاً |

**🔴 ثلاثةٌ لا تُكسر**:
1. **`picked` تشترط اكتمالَ اللقط.** بندٌ نقص ⇒ نقصٌ في المخزون يُقيَّد
   ويُبلَّغ، **ولا تمرّ الشحنة صامتة**.
2. **الباركود يتحقّق ولا يثق** (بند ١٥): مسحُ صنفٍ خطأ يوقف اللقط.
3. **التحصيل عند `shipped` وحده.** لا عند التأكيد ولا عند التغليف.

---

## ٤) `return_requests.state` — المرتجع

```
requested ──> approved ──> in_transit ──> received ──> inspected ──> completed
    │  ▲          │                                        │
    │  └info_req──┘                                   damaged/missing
    ▼                                                      │
 rejected                                          استردادٌ جزئيّ أو رفض
```

| من | إلى | المالك | ملاحظة |
|---|---|---|---|
| `requested` | `info_requested` | `support` | صورٌ ناقصة أو سببٌ غامض |
| `requested` | `approved` / `rejected` | `support` أو `operations` | **قرارٌ بشريّ، وسببُه إلزاميّ** |
| `approved` | `in_transit` | العميل أو مندوب الاستلام | — |
| `in_transit` | `received` | المستودع | يدخل موقع `returned` **لا `on_hand`** |
| `received` | `inspected` | المستودع | `resellable` أو `damaged` أو `missing` |
| `inspected` | `completed` | `finance` | يُصرف الاسترداد ⇒ `payment_status` يتحرّك |

**🔴 المخزونُ لا يعود إلى الرفّ آلياً.** الراجعُ يدخل موقعاً منفصلاً،
والقرارُ بعد الفحص بشريّ. **ومن يُعيده آلياً يبيع تالفاً لعميلٍ ثانٍ**
— ثم يخسر العميلين ويدفع شحنتين.

---

## ٥) الأحداث — العبورُ بين النطاقات

نطاقٌ لا يكتب في جدول نطاقٍ آخر ([`01-domain-model.md`](01-domain-model.md)).
فالانتقالاتُ تعبر بأحداثٍ تُكتب في `outbox_events` **داخل نفس معاملة
التغيير**:

| الحدث | من | من يستمع |
|---|---|---|
| `OrderPlaced` | ORDERING | INVENTORY (يحجز) · إشعار · تحليلات |
| `PaymentCaptured` | PAYMENTS | ORDERING (يؤكّد) · FINANCE |
| `FulfilmentShipped` | FULFILMENT | PAYMENTS (يُحصّل) · ORDERING · إشعار |
| `FulfilmentDelivered` | FULFILMENT | ORDERING · LOYALTY (يُقيّد النقاط) |
| `ReturnReceived` | RETURNS | INVENTORY (إلى موقع `returned`) |
| `RefundIssued` | PAYMENTS | ORDERING · FINANCE · إشعار |
| `LowStock` | INVENTORY | PURCHASING · إشعار |
| `PriceDropped` | PRICING | من في قائمة أمنياته (بند ٢٢) |

**ولماذا `outbox` لا طابورٌ مباشر**: الحدثُ يُكتب في **نفس المعاملة**
التي غيّرت الحالة. فإمّا أن يقعا معاً أو لا يقعا. ولا يُرسَل إشعارُ شحنٍ
لطلبٍ فشلت كتابتُه، ولا يضيع إشعارٌ لأن الطابور سقط لحظتها.

---

## ٦) كيف يُفرَض هذا في الكود

جدولُ الانتقالات **بيانات**، والانتقالُ يمرّ بدالّةٍ واحدة:

```ts
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft:     ['pending', 'cancelled'],
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],            // نهائيّ
  cancelled: [],            // نهائيّ
};
```

**والقواعد الثلاث**:
1. **لا `UPDATE orders SET status = …` في أي مكانٍ سوى هذه الدالّة.**
   يُفحص بقاعدة lint في CI، لا بالمراجعة البشرية.
2. الدالّة تفحص الانتقال، وتفحص **حارسَه** (الشروط أعلاه)، وتفحص
   **صلاحيةَ الفاعل**، ثم تكتب `audit_logs` و`outbox_events` في نفس
   المعاملة.
3. الانتقالُ المرفوض **يُرجع خطأً ويُسجَّل** — محاولةُ انتقالٍ ممنوع
   إمّا عطلٌ في الكود أو محاولةُ تجاوز، وكلاهما يستحق أن يُرى.
