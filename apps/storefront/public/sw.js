/**
 * عاملُ خدمةِ زادم.
 *
 * ── 🔴 القرارُ الحاكم: لا صفحةَ تُخزَّن. أبداً ────────────────────
 *
 * الوصفةُ الشائعة لعامل الخدمة «شبكةٌ ثم مخزنٌ احتياطيّ» على كلّ تنقّل.
 * وهي في متجرٍ **كارثةٌ ماليّة**: صفحةُ منتجٍ مخزَّنةٌ تعرض سعرَ أمس،
 * فيضيف الزائرُ إلى السلّة على ذلك السعر ثم تردّه الخلفيّةُ بـ
 * `PRICE_CHANGED` — أو الأسوأ: يُتمّ الطلبَ وهو يظنّ أنه دفع الأقلّ.
 * وشكوى «الموقع أراني سعراً غيرَ الذي حُوسبت به» لا يُصلحها اعتذار.
 *
 * فالتنقّلاتُ **شبكةٌ فقط**، وسقوطُها يعطي صفحةَ «لا اتصال» لا نسخةً
 * قديمة. والمخزَّنُ محصورٌ فيما **لا يتغيّر أبداً**: أصولُ Next
 * المبصومةُ بالمحتوى (`/_next/static/…` يحمل اسمُه بصمةَ محتواه، فتغيُّرُه
 * اسمٌ جديد لا محتوىً جديدٌ في اسمٍ قديم) والأيقونات.
 *
 * وما عدا ذلك — كلُّ نداءٍ إلى الخلفيّة، وكلُّ صورةِ منتج — **لا يُعترض
 * أصلاً**: لا `respondWith`، فيمرّ إلى الشبكة كأنّ العامل غيرُ موجود.
 */

const VERSION = "zadim-sw-1"
const SHELL = "zadim-shell-1"
const ASSETS = "zadim-assets-1"
const OFFLINE = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"]))
      // ⚠️ **وتخطّي الانتظار مقصود**: عاملٌ قديمٌ يبقى حاكماً حتى تُغلق
      // كلُّ الألسنة، وقد يبقى أياماً. فإصلاحُ عطبٍ فيه لا يصل.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** ما يجوز تخزينُه: مبصومٌ بالمحتوى أو ثابتٌ بطبيعته. */
function isImmutable(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)))
    return
  }

  if (isImmutable(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            // ولا يُخزَّن إلا الناجحُ التامّ: خزنُ 404 أو استجابةٍ جزئية
            // (206) يجعل العطبَ دائماً — يُقرأ من المخزن ولا يُعاد طلبُه.
            if (res.ok && res.status === 200) {
              const copy = res.clone()
              caches.open(ASSETS).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }

  // وكلُّ ما عداه يمرّ بلا اعتراض — أسعارٌ وسلّةٌ وطلباتٌ وصورُ منتجات.
})

// اسمُ الإصدارِ يُقرأ في الفحص، وبتغييره تُهجَر المخازنُ كلُّها.
self.__ZADIM_SW_VERSION = VERSION
