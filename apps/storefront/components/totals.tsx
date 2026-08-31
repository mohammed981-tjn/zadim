import { Price } from "@/components/price"
import { cn } from "@/lib/utils"

interface TotalsProps {
  itemTotal: number
  shippingTotal: number
  taxTotal: number
  discountTotal?: number
  total: number
  className?: string
}

/**
 * تفصيلُ المجاميع — مكوّنٌ واحدٌ تراه السلّةُ وشاشةُ الإتمام، فالرقمُ
 * الذي يوافق عليه العميلُ يُرسم في مكانٍ واحد.
 *
 * ── 🔴 والضريبةُ **مذكورةٌ لا مضافة** ─────────────────────────────
 *
 * ثابتُ الخلفيّة (`totalsBalance` في `checkout/pricing.ts`):
 *
 *     total = item_total + shipping_total
 *
 * و`tax_total` **داخلَ الاثنين** لا فوقهما. وقِيس على سلّةٍ حقيقية:
 * `91770 + 2875 = 94645` والضريبةُ `12345` منها.
 *
 * وكان هذا اللوحُ يسمّي `item_total` «المجموع الفرعي» ثم يضيف الضريبةَ
 * سطراً تحته — فيقرأ العميلُ ثلاثةَ أرقامٍ **لا تجمع إلى الرابع**.
 * وليس عطلاً في الحساب بل في الرواية: المبلغُ المخصوم صحيح، والشاشةُ
 * تشرحه شرحاً كاذباً. ومن يشكّ في فاتورته لا يعود.
 *
 * فالأصنافُ والشحنُ يُعرضان شاملَين، والضريبةُ سطرُ **«منه»**.
 */
export function Totals({ itemTotal, shippingTotal, taxTotal, discountTotal = 0, total, className }: TotalsProps) {
  return (
    <dl className={cn("space-y-3 text-sm", className)}>
      <Row label="الأصناف" value={<Price halalas={itemTotal} />} />
      {discountTotal > 0 ? (
        <Row label="الخصم" value={<Price halalas={-discountTotal} className="text-success" />} />
      ) : null}
      <Row
        label="الشحن"
        value={shippingTotal > 0 ? <Price halalas={shippingTotal} /> : <span className="text-success">مجاني</span>}
      />
      <div className="flex items-center justify-between border-t border-border pt-3">
        <dt className="text-base font-semibold">الإجمالي</dt>
        <dd>
          <Price halalas={total} className="text-lg font-bold" symbolClassName="text-sm" />
        </dd>
      </div>
      <p className="text-xs text-muted-foreground">
        الأسعار شاملة ضريبة القيمة المضافة ١٥٪ — منها <Price halalas={taxTotal} className="text-xs" />
      </p>
    </dl>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}
