/**
 * منطقُ اللقط — **دوالُّ خالصة**.
 *
 * ── 🔴 «الباركود يتحقّق ولا يثق» (بند ١٥) ──────────────────────
 *
 * الملقِّطُ يمسح ما في يده، لا ما في الورقة. فمسحُ صنفٍ خطأ **يوقف
 * اللقط** — ولا يُتجاهَل ولا يُقبل «مؤقّتاً».
 *
 * والسببُ أن الخطأ هنا **لا يُكتشف بعده**: الطردُ يُغلق ويُشحن، فيصل
 * العميلَ صنفٌ لم يطلبه — ويعود بشحنتين وشكوى. والمخزونُ في الوقت
 * نفسِه يقول إن الصنفَ الصحيح خرج، فيُباع مرّةً ثانية وهو على الرفّ.
 * **خطأٌ واحدٌ يُنتج ثلاثةَ أخطاء**، ولا يُرى واحدٌ منها إلا متأخّراً.
 *
 * فالإيقافُ الفوريُّ أرخصُ ما يمكن: ثوانٍ يقفها الملقّط، مقابل شحنتين
 * وعميلٍ ومخزونٍ يكذب.
 */

export type PickItem = {
  id: string;
  title: string;
  sku?: string | null;
  barcode?: string | null;
  quantity: number;
  picked_quantity: number;
  bin_location?: string | null;
  walk_order?: number;
};

export type ScanResult =
  | { accepted: true; item: PickItem; picked_quantity: number; complete: boolean }
  | {
      accepted: false;
      code: "UNKNOWN_BARCODE" | "ALREADY_COMPLETE" | "EMPTY_BARCODE";
      reason_ar: string;
      /** الباركودُ الخاطئ **يوقف القائمة**؛ والمكتملُ لا يوقفها. */
      blocks: boolean;
    };

export function scanBarcode(items: PickItem[], barcode: string): ScanResult {
  const code = (barcode ?? "").trim();
  if (!code) {
    return {
      accepted: false,
      code: "EMPTY_BARCODE",
      reason_ar: "لم يُقرأ باركود. أعِد المسح.",
      // مسحٌ فارغٌ عطلُ جهازٍ لا خطأُ صنف — ولا يوقف القائمة.
      blocks: false,
    };
  }

  const item = items.find((i) => (i.barcode ?? "") === code);

  if (!item) {
    return {
      accepted: false,
      code: "UNKNOWN_BARCODE",
      reason_ar: "هذا الصنف ليس في القائمة. توقّف وراجع الرفّ.",
      blocks: true,
    };
  }

  if (item.picked_quantity >= item.quantity) {
    return {
      accepted: false,
      code: "ALREADY_COMPLETE",
      reason_ar: `اكتملت كمّيةُ «${item.title}» (${item.quantity}).`,
      // زيادةٌ في نفس الصنف ليست خطأَ صنف: الملقّطُ مسح مرّتين. تُرفض
      // الزيادةُ ولا تُوقف المسيرة.
      blocks: false,
    };
  }

  const picked = item.picked_quantity + 1;
  return { accepted: true, item, picked_quantity: picked, complete: picked >= item.quantity };
}

/** هل اكتملت كلُّ البنود؟ — شرطُ الانتقال إلى `picked`. */
export function isComplete(items: PickItem[]): boolean {
  return items.length > 0 && items.every((i) => i.picked_quantity >= i.quantity);
}

export function shortfall(items: PickItem[]): Array<{ id: string; title: string; missing: number }> {
  return items
    .filter((i) => i.picked_quantity < i.quantity)
    .map((i) => ({ id: i.id, title: i.title, missing: i.quantity - i.picked_quantity }));
}

/**
 * ترتيبُ المشي — يُحوِّل القائمةَ إلى **مسيرةٍ واحدة**.
 *
 * وموقعُ الرفّ يُقرأ `A-03-12`: ممرٌّ ثم رفٌّ ثم صندوق. والفرزُ على
 * الأجزاء **عددياً لا نصّياً**: نصّياً يأتي `A-10` قبل `A-2`، فيمشي
 * الملقّطُ الممرَّ مرّتين.
 *
 * وما لا موقعَ له يُوضع في الآخر: يُبحث عنه بعد أن تُجمع الأكيدات.
 */
export function assignWalkOrder<T extends PickItem>(items: T[]): T[] {
  const parts = (bin?: string | null): number[] => {
    if (!bin) return [Number.MAX_SAFE_INTEGER];
    return bin
      .split(/[-_/\s]+/)
      .filter(Boolean)
      .map((p) => {
        const n = Number(p.replace(/\D/g, ""));
        const letters = p.replace(/[^A-Za-z]/g, "").toUpperCase();
        // الحرفُ يسبق الرقم في الوزن: الممرُّ `A` قبل `B` مهما كان رقمُه.
        return letters ? letters.charCodeAt(0) * 1000 + (Number.isFinite(n) ? n : 0) : n || 0;
      });
  };

  const sorted = [...items].sort((a, b) => {
    const pa = parts(a.bin_location);
    const pb = parts(b.bin_location);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] ?? -1;
      const vb = pb[i] ?? -1;
      if (va !== vb) return va - vb;
    }
    // حسمُ التعادل بالمعرّف: بلا هذا يختلف الترتيبُ بين تشغيلين على
    // نفس البيانات، فتصير قائمةُ اللقط غيرَ قابلةٍ لإعادة الإنتاج.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted.map((item, index) => ({ ...item, walk_order: index + 1 }));
}
