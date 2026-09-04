"use client"

import { useEffect } from "react"

/**
 * تسجيلُ عامل الخدمة.
 *
 * ── لماذا مكوّنٌ لا سطرٌ في التخطيط ────────────────────────────────
 *
 * التسجيلُ يحتاج `navigator` — أي متصفّحاً — والتخطيطُ يُصيَّر على
 * الخادم. فمكوّنُ عميلٍ لا يرسم شيئاً، مهمّتُه أثرٌ جانبيٌّ واحد.
 *
 * ── ولا يُسجَّل في التطوير ─────────────────────────────────────────
 *
 * عاملٌ في التطوير يخزّن أصولاً يعيد Turbopack بناءَها في كلّ حفظ،
 * فتُقرأ نسخةٌ ميتةٌ من المخزن ويُطارَد عطبٌ غيرُ موجودٍ في الكود.
 * وأسوأُ منه: يبقى مسجَّلاً في متصفّح المطوّر بعد إغلاق الخادم.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return

    // ولا يُسجَّل قبل `load`: التسجيلُ ينافس تحميلَ الصفحةِ الأولى على
    // نطاقٍ مخنوق، فيؤخّر أوّلَ رسمةٍ لأجل مكسبٍ لا يظهر إلا في الزيارة
    // التالية.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // وسقوطُ التسجيل **يُبتلع بقصد**: الموقعُ يعمل تماماً بلا عامل،
        // فرميُ خطأٍ في الطرفيّة يُقلق من يقرؤه بلا سببٍ يُصلحه.
      })
    }

    if (document.readyState === "complete") register()
    else {
      addEventListener("load", register)
      return () => removeEventListener("load", register)
    }
  }, [])

  return null
}
