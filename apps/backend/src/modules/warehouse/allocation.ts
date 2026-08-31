/**
 * اختيارُ المستودع — **دالّةٌ خالصة**.
 *
 * لا قاعدةَ بيانات ولا حاوية: تأخذ البنودَ والمتاحَ والملفّاتِ وتُعيد
 * خطّة. فتُختبر بمئة حالةٍ في أجزاءٍ من الثانية، ولا تحتاج مستودعاً
 * حقيقياً لتُثبت أنها تختار الصحيح.
 *
 * ── الترتيب: لماذا «الأقلُّ شحناتٍ» أوّلاً ───────────────────────
 *
 * تقسيمُ الطلب على مستودعين يضاعف أجرَ الشحن، ويُوصل الطلبَ على
 * دفعتين، ويضاعف احتمالَ التأخّر. فتُجرَّب أوّلاً **شحنةٌ واحدة تكفي
 * كلَّ البنود**، ولو من مستودعٍ أبعد. والتقسيمُ آخرُ الحلول لا أوّلها.
 *
 * ── وترتيبُ المستودعات ───────────────────────────────────────────
 *
 * ١. مدينةُ العميل أوّلاً — أسرعُ وأرخص.
 * ٢. ثم الأولويةُ التي ضبطها المدير (الأعلى أوّلاً).
 * ٣. ثم المعرّف — **حسماً للتعادل**. وبلا هذا الثالث يختلف الترتيبُ
 *    بين تشغيلين على نفس البيانات، فيصير الاختبارُ متذبذباً والعطلُ
 *    غيرَ قابلٍ لإعادة الإنتاج.
 */

export type AllocationLine = {
  inventory_item_id: string;
  quantity: number;
};

export type AvailabilityRow = {
  inventory_item_id: string;
  location_id: string;
  /** الموجودُ ناقصَ المحجوز. */
  available: number;
};

export type LocationProfileInput = {
  location_id: string;
  city?: string | null;
  priority?: number | null;
  is_fulfilment_enabled?: boolean | null;
};

export type AllocationPlan = {
  shipments: Array<{ location_id: string; lines: AllocationLine[] }>;
  /** ما لم يوجد له مخزونٌ في أيّ مستودعٍ مؤهَّل. */
  unfulfilled: AllocationLine[];
  split_count: number;
  fully_allocatable: boolean;
};

export type AllocationInput = {
  lines: AllocationLine[];
  availability: AvailabilityRow[];
  profiles?: LocationProfileInput[];
  /** مدينةُ عنوان الشحن — تُطابَق بلا حساسيةٍ لحالة الأحرف. */
  destination_city?: string | null;
};

const cityKey = (v?: string | null) => (v ?? "").trim().toLowerCase();

/**
 * ترتيبُ المستودعات المؤهَّلة. والمستودعُ **بلا ملفٍّ مؤهَّلٌ بأولوية
 * صفر**: الملفُّ يُرتّب ولا يأذن (انظر `models/location-profile.ts`).
 */
export function rankLocations(
  locationIds: string[],
  profiles: LocationProfileInput[] = [],
  destinationCity?: string | null
): string[] {
  const byId = new Map(profiles.map((p) => [p.location_id, p]));
  const target = cityKey(destinationCity);

  return locationIds
    .filter((id) => byId.get(id)?.is_fulfilment_enabled !== false)
    .sort((a, b) => {
      const pa = byId.get(a);
      const pb = byId.get(b);

      if (target) {
        const ma = cityKey(pa?.city) === target ? 1 : 0;
        const mb = cityKey(pb?.city) === target ? 1 : 0;
        if (ma !== mb) return mb - ma;
      }

      const ra = pa?.priority ?? 0;
      const rb = pb?.priority ?? 0;
      if (ra !== rb) return rb - ra;

      return a < b ? -1 : a > b ? 1 : 0;
    });
}

export function planAllocation(input: AllocationInput): AllocationPlan {
  const { lines, availability, profiles = [], destination_city } = input;

  // متاحٌ سالبٌ يُعامَل صفراً: عدّادٌ فاسدٌ يجب ألّا يُنتج شحنةً وهميّة.
  const stock = new Map<string, number>();
  const locationIds = new Set<string>();
  for (const row of availability) {
    locationIds.add(row.location_id);
    const key = `${row.location_id}::${row.inventory_item_id}`;
    stock.set(key, Math.max(0, Number(row.available) || 0));
  }

  const ranked = rankLocations([...locationIds], profiles, destination_city);
  const need = lines
    .filter((l) => Number(l.quantity) > 0)
    .map((l) => ({ inventory_item_id: l.inventory_item_id, quantity: Number(l.quantity) }));

  const at = (loc: string, item: string) => stock.get(`${loc}::${item}`) ?? 0;

  // ── ١) شحنةٌ واحدة تكفي؟ ───────────────────────────────────────
  for (const loc of ranked) {
    if (need.every((l) => at(loc, l.inventory_item_id) >= l.quantity)) {
      return {
        shipments: [{ location_id: loc, lines: need.map((l) => ({ ...l })) }],
        unfulfilled: [],
        split_count: 1,
        fully_allocatable: need.length > 0,
      };
    }
  }

  // ── ٢) وإلا: أكبرُ ما يمكن من الأعلى ترتيباً، ثم الباقي ───────
  const remaining = new Map(need.map((l) => [l.inventory_item_id, l.quantity]));
  const shipments: AllocationPlan["shipments"] = [];

  for (const loc of ranked) {
    const take: AllocationLine[] = [];
    for (const [item, qty] of remaining) {
      if (qty <= 0) continue;
      const got = Math.min(qty, at(loc, item));
      if (got > 0) {
        take.push({ inventory_item_id: item, quantity: got });
        remaining.set(item, qty - got);
      }
    }
    if (take.length) shipments.push({ location_id: loc, lines: take });
    if ([...remaining.values()].every((q) => q <= 0)) break;
  }

  const unfulfilled = [...remaining]
    .filter(([, q]) => q > 0)
    .map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));

  return {
    shipments,
    unfulfilled,
    split_count: shipments.length,
    fully_allocatable: unfulfilled.length === 0 && need.length > 0,
  };
}
