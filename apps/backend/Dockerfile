# خلفيّةُ زادم — صورةٌ للإنتاج.
#
# ── لماذا Dockerfile لا اكتشافٌ تلقائيّ من المنصّة ────────────────
#
# لأن تسلسلَ بناء Medusa **لا تخمّنه منصّة**: `medusa build` لا يُنتج
# ملفّاتٍ في مكانها، بل **خادماً كاملاً في `.medusa/server` له
# `package.json` و`package-lock.json` خاصّان به**. فمن يشغّل `npm ci`
# ثم `npm start` في جذر المشروع يشغّل مصدراً غيرَ مبنيّ.
#
# وقِيس هنا فعلاً: البناءُ يُخرج `client/` و`server/` و`types/`،
# و`server/` فيها قفلٌ مستقلٌّ بإحدى عشرة تبعيّة.
#
# ── ولماذا Debian لا Alpine ──────────────────────────────────────
#
# `sharp` (معالجةُ صور المنتجات) ثنائيّاتٌ أصليّة. ونسخةُ Alpine تحتاج
# musl وvips، وتسقط سقوطاً غامضاً وقتَ التشغيل لا وقتَ البناء.

# ── ١) البناء ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# الطبقةُ الأغلى أوّلاً: التبعيّاتُ لا تتغيّر مع كل سطرِ كود، فتُخزَّن.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx medusa build

# تبعيّاتُ الخادم المبنيّ — بلا أدوات التطوير.
WORKDIR /app/.medusa/server
RUN npm ci --omit=dev

# ── ٢) التشغيل ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# لا مصدرَ ولا أدواتِ بناءٍ في صورة الإنتاج: الخادمُ المبنيُّ وحدَه.
COPY --from=build /app/.medusa/server ./

# ⚠️ نقطةُ تثبيت القرص الدائم. وبلا قرصٍ هنا **تُفقد كلُّ صور المنتجات
# مع كل نشرة** — انظر تعليقَ وحدة الملفّات في `medusa-config.ts`.
RUN mkdir -p /app/static
VOLUME ["/app/static"]

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 9000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npx", "medusa", "start"]
