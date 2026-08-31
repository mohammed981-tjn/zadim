// حاجزُ تصدير. لا يُقرأ من مُحمِّل النماذج — فهو يتخطّى أي ملفٍ يبدأ
// بـ`index.` عمداً — بل يخدم استيرادَ الخدمة وحدَها.
export { BulkOperation } from "./bulk-operation";
export { BulkChange } from "./bulk-change";
