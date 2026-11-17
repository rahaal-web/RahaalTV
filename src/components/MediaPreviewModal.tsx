import { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Eye,
  Film,
  Globe,
  Languages,
  Layers,
  LayoutGrid,
  Play,
  Server,
  Star,
  Tv,
  Users,
  X,
} from 'lucide-react';
import { isLikelyNonVideoWebsiteUrl } from '../lib/clientScraper';
import {
  FALLBACK_BACKDROP,
  FALLBACK_POSTER,
  handleBackdropError,
  handlePosterError,
} from '../lib/mediaFilters';
import { MediaItem } from '../types/media';
import { MovieCard } from './MovieCard';

interface MediaPreviewModalProps {
  item: MediaItem | null;
  onClose: () => void;
  onConfirmPublish?: () => void;
  publishLabel?: string;
  busy?: boolean;
}

function extractSafePreviewSrc(embedCode?: string, url?: string): string | null {
  if (embedCode) {
    const match = embedCode.match(/src\s*=\s*["']([^"']+)["']/i);
    if (match && /^https?:\/\//i.test(match[1].trim())) {
      return match[1].trim();
    }
    if (/^https?:\/\//i.test(embedCode.trim())) {
      return embedCode.trim();
    }
  }
  if (url && /^https?:\/\//i.test(url.trim())) {
    return url.trim();
  }
  return null;
}

export function MediaPreviewModal({
  item,
  onClose,
  onConfirmPublish,
  publishLabel = 'تأكيد النشر في قاعدة البيانات',
  busy = false,
}: MediaPreviewModalProps) {
  const [previewMode, setPreviewMode] = useState<'page' | 'card'>('page');
  const [testServerIdx, setTestServerIdx] = useState<number | null>(null);

  if (!item) return null;

  const activeTestServer = testServerIdx !== null ? item.servers[testServerIdx] : null;
  const activeTestSrc = activeTestServer
    ? extractSafePreviewSrc(activeTestServer.embedCode, activeTestServer.url)
    : null;
  const activeTestIsPortal = Boolean(activeTestSrc && isLikelyNonVideoWebsiteUrl(activeTestSrc));
  const isDirectVideo = Boolean(activeTestSrc && /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(activeTestSrc));

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-2 sm:p-4">
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 w-[96vw] max-w-6xl max-h-[94vh] flex flex-col rounded-3xl bg-[#06131c] border border-[#f9c400]/35 shadow-2xl overflow-hidden">
        {/* Top Preview Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1a242e] px-5 py-3 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f9c400] px-2.5 py-1 text-[11px] font-black text-[#06131c]">
              <Eye className="w-3.5 h-3.5" />
              <span>معاينة قبل النشر</span>
            </span>
            <h3 className="font-display text-sm sm:text-base font-extrabold text-white truncate">
              {item.title || 'بدون عنوان'}
            </h3>
            <span className="text-[11px] font-bold text-[#b7c9ef] hidden md:inline">
              — لم يتم الحفظ في قاعدة البيانات بعد
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Switch between Page Preview and Card Preview */}
            <div className="flex rounded-xl bg-[#0c1821] p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setPreviewMode('page')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-extrabold cursor-pointer ${
                  previewMode === 'page'
                    ? 'bg-[#D92321] text-white'
                    : 'text-[#b7c9ef] hover:text-white'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>صفحة العمل</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('card')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-extrabold cursor-pointer ${
                  previewMode === 'card'
                    ? 'bg-[#D92321] text-white'
                    : 'text-[#b7c9ef] hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>البطاقة في الرئيسية</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-[#D92321] cursor-pointer"
              aria-label="إغلاق المعاينة"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Live Preview Body */}
        <div className="flex-1 overflow-y-auto">
          {previewMode === 'card' ? (
            <div className="p-6 sm:p-10 space-y-6">
              <div className="text-center space-y-1">
                <p className="text-sm font-extrabold text-white">
                  هكذا ستظهر بطاقة العمل في الصفحة الرئيسية والأقسام ونتائج البحث:
                </p>
                <p className="text-xs text-[#b7c9ef]">
                  مرّر المؤشر فوق البطاقة لاختبار تأثير الانقلاب ثلاثي الأبعاد والبيانات السريعة
                </p>
              </div>
              <div className="mx-auto max-w-[230px]">
                <MovieCard
                  item={item}
                  onSelect={() => setPreviewMode('page')}
                  isInWatchlist={false}
                  onToggleWatchlist={() => {}}
                />
              </div>
            </div>
          ) : (
            <div className="pb-6">
              {/* Hero Head Preview */}
              <div className="relative min-h-[250px] overflow-hidden border-b border-white/[0.08] bg-[#0c1821]">
                <img
                  src={item.backdrop || item.poster || FALLBACK_BACKDROP}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  onError={handleBackdropError}
                  className="absolute inset-0 h-full w-full object-cover opacity-35"
                />
                <div className="absolute inset-0 bg-[#06131c]/75" />
                <div className="moov-hex-pattern absolute inset-0" />
                <div className="moov-spotlight absolute inset-0" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 p-6 pt-16 min-h-[250px]">
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex flex-wrap gap-1.5">
                      {item.categories.map((cat) => (
                        <span
                          key={cat}
                          className="rounded-lg bg-[#D92321]/20 border border-[#D92321]/40 px-2.5 py-0.5 text-[11px] font-bold text-white"
                        >
                          {cat}
                        </span>
                      ))}
                      {item.pinned && (
                        <span className="rounded-lg bg-[#f9c400] px-2.5 py-0.5 text-[11px] font-black text-[#06131c]">
                          مثبت في الرئيسية
                        </span>
                      )}
                    </div>
                    <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                      {item.title} بجودة عالية
                    </h1>
                    <p className="text-xs sm:text-sm text-[#b7c9ef]">
                      {item.tagline || item.story.slice(0, 140)}
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-3 self-start md:self-end rounded-2xl bg-[#1a242e]/95 border border-[#f9c400]/35 px-4 py-2.5 shadow-xl">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f9c400] text-[#06131c]">
                      <Star className="w-5 h-5 fill-current" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-1">
                        <span className="font-latin text-xl font-black text-white">
                          {(Number(item.imdb) || 7.5).toFixed(1)}
                        </span>
                        <span className="font-latin text-xs font-bold text-[#b7c9ef]">/ 10</span>
                      </div>
                      <p className="font-latin text-[10px] font-bold text-[#b7c9ef]">IMDb</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Poster & Details Grid */}
              <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-4 lg:col-span-3">
                  <div className="relative aspect-[3/4] w-full max-w-[240px] mx-auto md:max-w-none overflow-hidden rounded-3xl border-4 border-[#1a242e] bg-[#0c1821] shadow-2xl">
                    <div className="moov-ribbon bg-[#D92321] py-1 text-[11px] font-black tracking-wider text-white font-latin uppercase">
                      {item.quality}
                    </div>
                    <img
                      src={item.poster || FALLBACK_POSTER}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={handlePosterError}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>

                <div className="md:col-span-8 lg:col-span-9 space-y-5">
                  {/* Story */}
                  <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
                    <h4 className="font-display text-base font-extrabold text-white mb-2 flex items-center gap-2">
                      <span className="h-4 w-1.5 rounded-full bg-[#D92321]" />
                      قصة العرض
                    </h4>
                    <p className="text-xs sm:text-sm leading-relaxed text-[#b7c9ef]">{item.story}</p>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="rounded-xl bg-[#1a242e]/70 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[#b7c9ef] flex items-center gap-1.5">
                        <Film className="w-3.5 h-3.5 text-[#D92321]" />
                        النوع
                      </span>
                      <span className="font-bold text-white truncate">{item.genres.join('، ')}</span>
                    </div>
                    <div className="rounded-xl bg-[#1a242e]/70 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[#b7c9ef] flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#D92321]" />
                        السنة
                      </span>
                      <span className="font-latin font-bold text-white">{item.year}</span>
                    </div>
                    <div className="rounded-xl bg-[#1a242e]/70 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[#b7c9ef] flex items-center gap-1.5">
                        <Languages className="w-3.5 h-3.5 text-[#D92321]" />
                        اللغة
                      </span>
                      <span className="font-bold text-white truncate">{item.language}</span>
                    </div>
                    <div className="rounded-xl bg-[#1a242e]/70 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[#b7c9ef] flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-[#D92321]" />
                        البلد
                      </span>
                      <span className="font-bold text-white truncate">{item.country}</span>
                    </div>
                    <div className="rounded-xl bg-[#1a242e]/70 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[#b7c9ef] flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#D92321]" />
                        المدة
                      </span>
                      <span className="font-bold text-white">{item.duration}</span>
                    </div>
                    <div className="rounded-xl bg-[#1a242e]/70 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[#b7c9ef] flex items-center gap-1.5">
                        <Tv className="w-3.5 h-3.5 text-[#D92321]" />
                        الجودة
                      </span>
                      <span className="font-latin font-black text-[#f9c400]">{item.quality}</span>
                    </div>
                  </div>

                  {/* Watch Servers Preview (Compact Number + Quality) */}
                  <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-2">
                        <Server className="w-4 h-4 text-[#D92321]" />
                        <span>سيرفرات المشاهدة ({item.servers.length})</span>
                      </h4>
                      <span className="text-[11px] text-[#b7c9ef]">اضغط على رقم السيرفر لتجربة تشغيله الآن</span>
                    </div>

                    {item.servers.length === 0 ? (
                      <p className="text-xs text-[#f9c400]">لم تُضف سيرفرات مشاهدة بعد.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {item.servers.map((srv, idx) => {
                          const cleanQ =
                            String(srv.quality || item.quality || 'HD')
                              .replace(/مستورد|embed/gi, '')
                              .trim() || 'HD';
                          const isTesting = testServerIdx === idx;
                          return (
                            <button
                              key={srv.id || idx}
                              type="button"
                              onClick={() => setTestServerIdx(isTesting ? null : idx)}
                              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 cursor-pointer transition-all ${
                                isTesting
                                  ? 'bg-[#D92321] border-[#ff5a58] text-white shadow-[0_6px_18px_rgba(217,35,33,0.4)]'
                                  : 'bg-[#1a242e] border-white/10 text-white hover:border-[#D92321]'
                              }`}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="font-latin flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-black/30 text-[11px] font-black tabular-nums">
                                  {idx + 1}
                                </span>
                                <span className="text-xs font-extrabold truncate">
                                  سيرفر {idx + 1}
                                </span>
                              </span>
                              <span className="font-latin text-[10px] font-black text-[#f9c400] shrink-0">
                                {cleanQ}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Inline Test Player inside Preview (RahaL TV Crimson Box) */}
                    {testServerIdx !== null && (
                      <div className="mt-3 rounded-2xl border-2 border-[#D92321]/80 bg-[#050b11] shadow-[0_12px_32px_rgba(217,35,33,0.22)] overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-l from-[#1a0a0d] via-[#120d14] to-[#0b131d] border-b border-[#D92321]/35 text-xs">
                          <span className="font-extrabold text-white flex items-center gap-2">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#D92321] text-white">
                              <Play className="w-3 h-3 fill-current" />
                            </span>
                            <span>سيرفر {testServerIdx + 1} — مشغل RahaL TV</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setTestServerIdx(null)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#D92321]/15 hover:bg-[#D92321] px-2.5 py-1 text-[11px] font-bold text-[#ff8a88] hover:text-white transition-colors cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                            <span>إغلاق</span>
                          </button>
                        </div>
                        <div className="relative aspect-video w-full bg-black overflow-hidden">
                          <span className="pointer-events-none absolute top-2 right-2 z-10 h-3 w-3 border-t-2 border-r-2 border-[#D92321]/85 rounded-tr" />
                          <span className="pointer-events-none absolute top-2 left-2 z-10 h-3 w-3 border-t-2 border-l-2 border-[#D92321]/85 rounded-tl" />
                          {activeTestSrc && !activeTestIsPortal ? (
                            isDirectVideo ? (
                              <video src={activeTestSrc} controls autoPlay playsInline className="w-full h-full" />
                            ) : (
                              <iframe
                                src={activeTestSrc}
                                title={`Preview Server ${testServerIdx + 1}`}
                                allowFullScreen
                                referrerPolicy="no-referrer"
                                className="w-full h-full border-0"
                              />
                            )
                          ) : activeTestIsPortal ? (
                            <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
                              <AlertTriangle className="w-8 h-8 text-[#D92321]" />
                              <p className="text-xs font-extrabold text-white">
                                تم حجب هذا الرابط لأنه صفحة موقع رئيسية وليس مشغل فيديو
                              </p>
                              <p className="font-latin text-[11px] text-[#b7c9ef]/70 truncate max-w-full" dir="ltr">
                                {activeTestSrc}
                              </p>
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-[#b7c9ef]">
                              لا يوجد رابط تشغيل صالح في هذا السيرفر
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Downloads, Episodes & Cast summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl bg-[#0c1821] border border-white/[0.08] p-3.5">
                      <p className="font-extrabold text-white flex items-center gap-1.5 mb-1">
                        <Download className="w-3.5 h-3.5 text-[#4CAF50]" />
                        روابط التحميل
                      </p>
                      <p className="text-[#b7c9ef]">{item.downloads.length} رابط متاح</p>
                    </div>
                    <div className="rounded-xl bg-[#0c1821] border border-white/[0.08] p-3.5">
                      <p className="font-extrabold text-white flex items-center gap-1.5 mb-1">
                        <Layers className="w-3.5 h-3.5 text-[#f9c400]" />
                        المواسم والحلقات
                      </p>
                      <p className="text-[#b7c9ef]">
                        {item.seasons?.[0]?.episodes.length || 0} حلقة مضافة
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#0c1821] border border-white/[0.08] p-3.5">
                      <p className="font-extrabold text-white flex items-center gap-1.5 mb-1">
                        <Users className="w-3.5 h-3.5 text-[#D92321]" />
                        فريق العمل
                      </p>
                      <p className="text-[#b7c9ef]">{item.cast.length} ممثل</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1a242e] px-5 py-3.5 border-t border-white/10">
          <p className="text-xs text-[#b7c9ef]">
            راجع البيانات والصورة والسيرفرات قبل اعتماد النشر النهائي.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2.5 text-xs font-extrabold text-white cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>العودة للتعديل</span>
            </button>
            {onConfirmPublish && (
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmPublish}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{busy ? 'جاري النشر...' : publishLabel}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
