# 🚀 دليل النشر على Vercel

## ماذا في هذا الدليل

هذا الملف يشرح كيفية نشر تطبيق **Storefront** (واجهة العميل) على Vercel.

> ⚠️ **ملاحظة**: الخادم الخلفي (Backend) يحتاج نشراً منفصلاً على منصة أخرى مثل Railway أو Heroku أو server مخصص.

---

## 📋 المتطلبات

- حساب على [Vercel](https://vercel.com) (مجاني)
- المستودع موجود على GitHub/GitLab/Bitbucket
- بيانات الاتصال بالخادم الخلفي (الـ URL ومفتاح النشر)

---

## 🔧 الخطوات

### الخطوة ١: تجهيز ملف البيئة المحلي

```bash
cd apps/storefront
cp .env.example .env.local
```

ثم عدّل `.env.local`:
```env
NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000  # الخادم الخلفي المحلي
NEXT_PUBLIC_MEDUSA_PK=pk_عرب_your_key_here
```

### الخطوة ٢: اختبر البناء محلياً

```bash
cd apps/storefront
npm install
npm run build
npm start
```

يجب أن تشتغل الواجهة على http://localhost:3000

### الخطوة ٣: ادفع إلى GitHub

```bash
git add .
git commit -m "chore: prepare for Vercel deployment"
git push origin your-branch
```

### الخطوة ٤: اربط المستودع بـ Vercel

1. اذهب إلى [Vercel Dashboard](https://vercel.com/dashboard)
2. اضغط **Add New Project**
3. اختر المستودع من GitHub/GitLab/Bitbucket
4. اضغط **Continue**
5. في **Framework**: اختر **Next.js**
6. في **Root Directory**: اختر `apps/storefront`
   > Vercel سيكتشف هذا تلقائياً من ملف `vercel.json`
7. اضغط **Deploy**

### الخطوة ٥: أضف متغيرات البيئة

بعد الـ deploy الأول سيفشل لأن البيانات ناقصة. عدّل متغيرات البيئة:

1. اذهب إلى المشروع في Vercel
2. اضغط **Settings** → **Environment Variables**
3. أضف:
   - **Key**: `NEXT_PUBLIC_MEDUSA_URL` → **Value**: عنوان الخادم الخلفي (مثلاً: `https://api.zadim.com`)
   - **Key**: `NEXT_PUBLIC_MEDUSA_PK` → **Value**: مفتاح النشر (اطلبه من فريق الخادم)
4. اضغط **Save**
5. اذهب إلى **Deployments** واضغط **Redeploy** على آخر deployment

### الخطوة ٦: تحقق من النشر

انقر على رابط الـ domain — يجب أن تفتح الواجهة بشكل صحيح.

---

## 🔐 متغيرات البيئة المهمة

| المتغير | مثال | ملاحظة |
|---------|-----|--------|
| `NEXT_PUBLIC_MEDUSA_URL` | `https://api.zadim.com` | عنوان الخادم الخلفي — **يصل المتصفّح** |
| `NEXT_PUBLIC_MEDUSA_PK` | `pk_xxxxxxx` | مفتاح النشر — **يصل المتصفّح** |

> ⚠️ أي شيء يبدأ بـ `NEXT_PUBLIC_` يظهر في كود المتصفّح. **لا تضع أسراراً هنا أبداً**.

---

## 🐛 حل المشاكل

### مشكلة: "Build failed"

**السبب المحتمل**: متغيرات البيئة ناقصة
**الحل**:
1. اذهب إلى Vercel → **Settings** → **Environment Variables**
2. تأكد من وجود `NEXT_PUBLIC_MEDUSA_URL` و `NEXT_PUBLIC_MEDUSA_PK`
3. أعد التوزيع (Redeploy)

### مشكلة: "API is not responding"

**السبب المحتمل**: خادم Medusa معطّل أو غير متصل
**الحل**:
1. تحقق من أن الخادم يشتغل: `curl https://your-medusa-url/health`
2. تحقق من أن `NEXT_PUBLIC_MEDUSA_URL` صحيح في Vercel settings
3. تحقق من CORS settings في الخادم

### مشكلة: "Fonts don't load"

**السبب**: استبدلنا Google Fonts بخطوط النظام للتوافقية
**الحل**: إذا كنت تريد خطوط مخصصة، أضفها إلى `public/fonts/` واستخدم `next/font/local`

---

## 🔄 التحديثات المستقبلية

- [ ] نقل الخطوط إلى local files بدل نظام الخطوط
- [ ] إضافة صور معطّلة حالياً
- [ ] إعداد CDN للصور
- [ ] تكوين DNS custom domain

---

## 📚 المراجع

- [Vercel Docs](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Medusa Storefront](https://docs.medusajs.com/storefront/general-info)

---

**آخر تحديث**: 2026-09-01
