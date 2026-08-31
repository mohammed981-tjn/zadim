// حاجزُ تصدير. لا يقرؤه مُحمِّل النماذج — فهو يتخطّى أي ملفٍ يبدأ
// بـ`index.` عمداً (درسُ المرحلة ١) — بل يخدم استيرادَ الخدمة وحدها.
export { Attribute } from "./attribute";
export { CategoryAttribute } from "./category-attribute";
export { ProductAttributeValue } from "./product-attribute-value";
export { SearchSynonym } from "./search-synonym";
export { SeoMeta } from "./seo-meta";
export { UrlRedirect } from "./url-redirect";
