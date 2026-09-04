import { readdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * اكتشافُ مزوّدي الإشعارات — **نفسُ عقد `carriers/discover.ts`**.
 *
 * والبوّابةُ هناك نصُّها: «إضافةُ ناقلٍ ثانٍ لا تعدّل ملفاً واحداً خارج
 * مجلد المحوّلات». ونفسُ الحجّة هنا حرفياً: مزوّدُ بريدٍ أو رسائلَ
 * نصّيةٍ يُضاف **بمجلَّدٍ واحد**.
 *
 * ولو كانت قائمةً في الإعداد لبدأ الانحدارُ بسطر: بعده مسارٌ يعرف
 * الأسماء، ثم واجهةٌ تعرفها، ثم يصير المزوّدُ الجديد ورشةَ يومين.
 *
 * ⚠️ **والاكتشافُ على وجود `index` لا على الاسم**: مجلَّدٌ نصفُ مكتوبٍ
 * لا يُسجَّل فيسقط الإقلاعُ برسالةٍ لا تدلّ على سببها.
 */
export type DiscoveredProvider = {
  id: string;
  dir: string;
  /**
   * مسارُ الملفّ **بامتداده**.
   *
   * 🔴 والامتدادُ لازمٌ ولا يُحذف: قِيس أن `import()` لمسارٍ مطلقٍ بلا
   * امتداد يرمي «Cannot find module» — و**الامتدادُ يختلف بين التطوير
   * والإنتاج** (`.ts` قبل `medusa build` و`.js` بعده). فيُعاد ما وُجد
   * فعلاً بدل أن يُخمَّن.
   */
  entry: string;
};

const PROVIDERS_DIR = "src/modules/notify/providers";

export function discoverNotifyProviders(root = process.cwd()): DiscoveredProvider[] {
  const dir = join(root, PROVIDERS_DIR);
  if (!existsSync(dir)) return [];

  const found: DiscoveredProvider[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    // `.js` أوّلاً: بعد البناء يوجد الاثنان أحياناً، والمُشغَّلُ هو
    // المترجَم.
    const entry = ["index.js", "index.ts"]
      .map((f) => join(dir, e.name, f))
      .find((f) => existsSync(f));
    if (!entry) continue;
    found.push({ id: e.name, dir: join(dir, e.name), entry });
  }
  return found.sort((a, b) => (a.id < b.id ? -1 : 1));
}
