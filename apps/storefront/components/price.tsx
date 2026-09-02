import { formatHalalas, sarLabel } from "@/lib/money"
import type { Locale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * يرسم الهللاتِ الصحيحةَ مبلغاً **بلغة الصفحة**: «٣٩٩٫٠٠ ر.س» عربياً
 * و«399.00 SAR» إنجليزياً. والأرقامُ جدوليّةٌ كي لا يهتزّ العمودُ
 * المصفوف.
 *
 * و`locale` إلزاميّةٌ بلا قيمةٍ افتراضية عمداً: افتراضُ العربية يجعل
 * سعراً عربياً يتسلّل إلى صفحةٍ إنجليزيةٍ **بلا خطأ ترجمة** — وهو
 * بالضبط العطلُ الذي وقع. والمترجمُ يرفض النداءَ الناقص.
 */
export function Price({
  halalas,
  locale,
  className,
  symbolClassName,
}: {
  halalas: number
  locale: Locale
  className?: string
  symbolClassName?: string
}) {
  return (
    <span className={cn("tabular inline-flex items-baseline gap-1", className)}>
      <span>{formatHalalas(halalas, locale)}</span>
      <span className={cn("text-[0.75em] font-medium text-muted-foreground", symbolClassName)}>
        {sarLabel(locale)}
      </span>
    </span>
  )
}
