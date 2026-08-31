import { readdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * اكتشافُ المحوّلات — **جوهرُ بوّابة «ناقلٌ ثانٍ بلا تعديل»**.
 *
 * ── لماذا قراءةُ مجلَّدٍ لا قائمةٌ في الإعداد ───────────────────
 *
 * البوّابة نصُّها: «إضافةُ ناقلٍ ثانٍ **لا تعدّل ملفاً واحداً خارج مجلد
 * المحوّلات**». وقائمةٌ في `medusa-config.ts` تكسر ذلك بسطرٍ واحد —
 * وسطرٌ واحدٌ يكفي ليصير الوعدُ كذبةً صغيرة، ثم تكبر: بعده مسارٌ يعرف
 * الأسماء، ثم واجهةٌ تعرفها، ثم يصير الناقلُ الجديد ورشةَ يومين.
 *
 * فالإعدادُ يقرأ هذا المجلد. وإضافةُ ناقلٍ **مجلَّدٌ واحدٌ وكفى**،
 * ويفحص `verify-fulfilment.ts` أن اسمَه لا يظهر خارجه.
 *
 * ── وما يُتخطّى ────────────────────────────────────────────────
 *
 * `README.md` وهذا الملفّ نفسُه: ليسا مجلَّدين. والفحصُ على **وجود
 * `index`** لا على الاسم — فمجلَّدٌ نصفُ مكتوبٍ لا يُسجَّل مزوّداً
 * فيسقط الإقلاعُ برسالةٍ لا تدلّ على سببها.
 */

export type DiscoveredCarrier = { id: string; resolve: string };

const CARRIERS_DIR = "./src/modules/carriers";

export function discoverCarriers(root = process.cwd()): DiscoveredCarrier[] {
  const dir = join(root, CARRIERS_DIR);
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) =>
      ["index.ts", "index.js"].some((f) => existsSync(join(dir, e.name, f)))
    )
    .map((e) => ({ id: e.name, resolve: `${CARRIERS_DIR}/${e.name}` }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
