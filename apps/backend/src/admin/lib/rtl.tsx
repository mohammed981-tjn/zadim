import type { PropsWithChildren } from "react";

/**
 * غلافُ صفحةٍ عربيّة داخل لوحةِ Medusa.
 *
 * ── لماذا غلافٌ لا إعدادٌ عامّ ──────────────────────────────────
 *
 * لوحةُ Medusa مبنيّةٌ يساراً-يميناً، وقلبُ اتجاهها كلِّها يكسر شاشاتِها
 * هي — قوائمَها وجداولَها ونوافذَها. فالاتجاهُ يُقلب **في صفحاتنا
 * وحدها**، وتبقى شاشاتُ Medusa كما بُنيت.
 *
 * وهذا حلٌّ يُعلَن لا يُطوى: **الواجهةُ العربية الكاملة هي واجهةُ العميل
 * والمستودع** (المرحلة ٩)، وهذه اللوحةُ أداةُ تشغيلٍ داخلية.
 */
export function Rtl({ children }: PropsWithChildren) {
  return (
    <div dir="rtl" style={{ textAlign: "right" }}>
      {children}
    </div>
  );
}

/** يقرأ من مسارات `/admin` بجلسة اللوحة نفسِها. */
export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

export async function adminPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error?.message_ar ?? `${res.status}`);
  return json as T;
}

/** الهللاتُ ⇒ ريالاتٌ بمنزلتين، بحسابٍ صحيحٍ لا عائم (ADR-008). */
export function riyals(halalas: number): string {
  const n = Math.trunc(Number(halalas) || 0);
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.floor(abs / 100).toLocaleString("ar-SA")}.${String(abs % 100).padStart(2, "0")}`;
}
