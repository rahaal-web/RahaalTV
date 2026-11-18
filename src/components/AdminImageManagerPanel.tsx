import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Eye,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  RefreshCw,
  Ruler,
  Search,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { bulkUpdateMediaInFirestore, saveMediaToFirestore } from '../lib/firebase';
import { handleBackdropError, handlePosterError } from '../lib/mediaFilters';
import {
  evaluateImageQuality,
  getBackdropInfo,
  getMediaImageQualityStatus,
  getPosterUrl,
  IMAGE_QUALITY_BADGE_MAP,
  probeImageDimensionsInBrowser,
  ResolvedImageBundle,
  resolveHighResImagesClient,
  upgradeKnownImageUrl,
} from '../lib/mediaImages';
import { ImageQualityStatus, MediaItem } from '../types/media';

interface AdminImageManagerPanelProps {
  user: User;
  catalog: MediaItem[];
  isFirestoreSeeded: boolean;
  onNotify: (msg: string) => void;
}

interface BatchUpgradeCandidate {
  item: MediaItem;
  beforePoster: string;
  beforeBackdrop: string;
  beforePw: number;
  beforePh: number;
  beforeBw: number;
  beforeBh: number;
  resolved: ResolvedImageBundle;
  selected: boolean;
}

export function AdminImageManagerPanel({
  user,
  catalog,
  isFirestoreSeeded,
  onNotify,
}: AdminImageManagerPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'issues' | ImageQualityStatus
  >('all');

  const [scanningAll, setScanningAll] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });

  const [batchUpgrading, setBatchUpgrading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [batchCandidates, setBatchCandidates] = useState<BatchUpgradeCandidate[] | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);

  const [fetchingItemId, setFetchingItemId] = useState<string | null>(null);
  const [singlePreview, setSinglePreview] = useState<{
    item: MediaItem;
    resolved: ResolvedImageBundle;
  } | null>(null);
  const [savingSingle, setSavingSingle] = useState(false);

  const [manualModalItem, setManualModalItem] = useState<MediaItem | null>(null);
  const [manualPosterUrl, setManualPosterUrl] = useState('');
  const [manualBackdropUrl, setManualBackdropUrl] = useState('');
  const [manualDims, setManualDims] = useState<{
    pw: number;
    ph: number;
    bw: number;
    bh: number;
    measured: boolean;
  }>({ pw: 0, ph: 0, bw: 0, bh: 0, measured: false });
  const [probingManual, setProbingManual] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

  const catalogWithStatus = useMemo(() => {
    return catalog.map((item) => {
      const status = getMediaImageQualityStatus(item);
      const posterUrl = getPosterUrl(item);
      const backdropInfo = getBackdropInfo(item);
      return { item, status, posterUrl, backdropInfo };
    });
  }, [catalog]);

  const stats = useMemo(() => {
    let high = 0;
    let medium = 0;
    let missingBackdrop = 0;
    let low = 0;
    let unknown = 0;
    for (const row of catalogWithStatus) {
      if (row.status === 'high') high++;
      else if (row.status === 'medium') medium++;
      else if (row.status === 'missing_backdrop') missingBackdrop++;
      else if (row.status === 'low') low++;
      else unknown++;
    }
    return { total: catalogWithStatus.length, high, medium, missingBackdrop, low, unknown };
  }, [catalogWithStatus]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalogWithStatus.filter((row) => {
      if (statusFilter === 'issues') {
        if (row.status === 'high' || row.status === 'medium') return false;
      } else if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        row.item.title.toLowerCase().includes(q) ||
        row.item.englishTitle.toLowerCase().includes(q) ||
        (row.item.image_source || '').toLowerCase().includes(q)
      );
    });
  }, [catalogWithStatus, searchQuery, statusFilter]);

  const handleScanDimensions = async (onlyUnmeasured = false) => {
    if (!isFirestoreSeeded) {
      onNotify('يرجى استيراد الكتالوج إلى Firestore أولاً لحفظ نتائج فحص الأبعاد.');
      return;
    }
    const targets = catalog.filter((item) =>
      onlyUnmeasured
        ? !item.poster_width || !item.poster_height || (Boolean(item.backdrop_url) && !item.backdrop_width)
        : true
    );
    if (targets.length === 0) {
      onNotify('جميع الأعمال مقاسة الأبعاد بالفعل.');
      return;
    }

    setScanningAll(true);
    setScanProgress({ done: 0, total: targets.length });
    const updatedItems: MediaItem[] = [];

    try {
      const CONCURRENCY = 4;
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const chunk = targets.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (item) => {
            const pUrl = getPosterUrl(item);
            const bInfo = getBackdropInfo(item);
            const [pProbe, bProbe] = await Promise.all([
              probeImageDimensionsInBrowser(pUrl),
              bInfo.hasDedicatedBackdrop
                ? probeImageDimensionsInBrowser(bInfo.url)
                : Promise.resolve(null),
            ]);

            const pw = pProbe.ok ? pProbe.width : item.poster_width || 0;
            const ph = pProbe.ok ? pProbe.height : item.poster_height || 0;
            const bw = bProbe?.ok ? bProbe.width : item.backdrop_width || 0;
            const bh = bProbe?.ok ? bProbe.height : item.backdrop_height || 0;
            const validBackdropUrl =
              bInfo.hasDedicatedBackdrop && (bw === 0 || bw > bh) ? bInfo.url : '';

            const nextStatus = evaluateImageQuality({
              posterUrl: pUrl,
              backdropUrl: validBackdropUrl,
              posterWidth: pw,
              posterHeight: ph,
              backdropWidth: validBackdropUrl ? bw : 0,
              backdropHeight: validBackdropUrl ? bh : 0,
            });

            return {
              ...item,
              poster: pUrl,
              poster_url: pUrl,
              backdrop_url: validBackdropUrl,
              backdrop: validBackdropUrl || item.backdrop,
              poster_width: pw,
              poster_height: ph,
              backdrop_width: validBackdropUrl ? bw : 0,
              backdrop_height: validBackdropUrl ? bh : 0,
              image_source: item.image_source || 'measured',
              image_quality_status: nextStatus,
            };
          })
        );
        updatedItems.push(...results);
        setScanProgress({ done: updatedItems.length, total: targets.length });
      }

      await bulkUpdateMediaInFirestore(updatedItems, user.uid);
      onNotify(`تم قياس الأبعاد الفعلية وتحديث حالة ${updatedItems.length} عمل في قاعدة البيانات.`);
    } catch {
      onNotify('تعذر حفظ نتائج قياس الصور — تحقق من اتصال Firestore.');
    } finally {
      setScanningAll(false);
    }
  };

  const handlePrepareBatchUpgrade = async () => {
    const weakRows = catalogWithStatus.filter(
      (r) =>
        r.status === 'missing_backdrop' ||
        r.status === 'low' ||
        r.status === 'unknown'
    );
    if (weakRows.length === 0) {
      onNotify('جميع الأعمال الحالية تمتلك بوستر وخلفيات بحالة جيدة.');
      return;
    }

    const targets = weakRows.slice(0, 25).map((r) => r.item);
    setBatchUpgrading(true);
    setBatchProgress({ done: 0, total: targets.length });

    try {
      const candidates: BatchUpgradeCandidate[] = [];
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const beforePoster = getPosterUrl(item);
        const beforeBInfo = getBackdropInfo(item);
        const resolved = await resolveHighResImagesClient({
          title: item.title,
          englishTitle: item.englishTitle,
          year: item.year,
          kind: item.kind,
          currentPoster: beforePoster,
          currentBackdrop: beforeBInfo.hasDedicatedBackdrop ? beforeBInfo.url : '',
        });

        const hasPosterUpgrade =
          Boolean(resolved.poster_url && resolved.poster_url !== beforePoster) ||
          resolved.poster_width > (item.poster_width || 0);
        const hasBackdropUpgrade =
          Boolean(
            resolved.backdrop_url &&
              resolved.backdrop_url !== (beforeBInfo.hasDedicatedBackdrop ? beforeBInfo.url : '')
          ) || resolved.backdrop_width > (item.backdrop_width || 0);

        if (hasPosterUpgrade || hasBackdropUpgrade) {
          candidates.push({
            item,
            beforePoster,
            beforeBackdrop: beforeBInfo.hasDedicatedBackdrop ? beforeBInfo.url : '',
            beforePw: item.poster_width || 0,
            beforePh: item.poster_height || 0,
            beforeBw: item.backdrop_width || 0,
            beforeBh: item.backdrop_height || 0,
            resolved,
            selected: true,
          });
        }
        setBatchProgress({ done: i + 1, total: targets.length });
      }

      if (candidates.length === 0) {
        onNotify(
          'تم فحص العناصر الناقصة ولم يتم العثور على صور أفضل موثوقة تلقائياً — يمكنك تعديلها يدوياً أو إضافة TMDB_API_KEY في الخادم.'
        );
      } else {
        setBatchCandidates(candidates);
      }
    } finally {
      setBatchUpgrading(false);
    }
  };

  const handleConfirmBatchUpgrade = async () => {
    if (!batchCandidates) return;
    if (!isFirestoreSeeded) {
      onNotify('يرجى استيراد الكتالوج إلى Firestore أولاً لحفظ التعديلات.');
      return;
    }
    const chosen = batchCandidates.filter((c) => c.selected);
    if (chosen.length === 0) {
      onNotify('اختر عملاً واحداً على الأقل لتطبيق الترقية.');
      return;
    }

    setSavingBatch(true);
    try {
      const patchedItems: MediaItem[] = chosen.map((c) => {
        const finalPoster = c.resolved.poster_url || c.beforePoster;
        const finalBackdrop = c.resolved.backdrop_url || c.beforeBackdrop;
        return {
          ...c.item,
          poster: finalPoster,
          poster_url: finalPoster,
          backdrop_url: finalBackdrop,
          backdrop: finalBackdrop || c.item.backdrop,
          poster_width: c.resolved.poster_width || c.item.poster_width || 0,
          poster_height: c.resolved.poster_height || c.item.poster_height || 0,
          backdrop_width: c.resolved.backdrop_width || c.item.backdrop_width || 0,
          backdrop_height: c.resolved.backdrop_height || c.item.backdrop_height || 0,
          image_source: c.resolved.image_source || c.item.image_source || 'tmdb',
          image_quality_status: c.resolved.image_quality_status,
        };
      });

      await bulkUpdateMediaInFirestore(patchedItems, user.uid);
      onNotify(`تم ترقية وحفظ صور ${patchedItems.length} عمل بنجاح بدون المساس ببقية البيانات!`);
      setBatchCandidates(null);
    } catch {
      onNotify('حدث خطأ أثناء حفظ ترقية الصور.');
    } finally {
      setSavingBatch(false);
    }
  };

  const handleFetchHqForItem = async (item: MediaItem) => {
    setFetchingItemId(item.id);
    try {
      const curPoster = getPosterUrl(item);
      const curBackdrop = getBackdropInfo(item);
      const resolved = await resolveHighResImagesClient({
        title: item.title,
        englishTitle: item.englishTitle,
        year: item.year,
        kind: item.kind,
        currentPoster: curPoster,
        currentBackdrop: curBackdrop.hasDedicatedBackdrop ? curBackdrop.url : '',
      });
      setSinglePreview({ item, resolved });
    } catch {
      onNotify('تعذر جلب صور عالية الجودة لهذا العمل حالياً.');
    } finally {
      setFetchingItemId(null);
    }
  };

  const handleApplySinglePreview = async () => {
    if (!singlePreview) return;
    if (!isFirestoreSeeded) {
      onNotify('يرجى استيراد الكتالوج إلى Firestore أولاً لحفظ التغييرات.');
      return;
    }
    const { item, resolved } = singlePreview;
    setSavingSingle(true);
    try {
      const nextPoster = resolved.poster_url || getPosterUrl(item);
      const prevB = getBackdropInfo(item);
      const nextBackdrop =
        resolved.backdrop_url || (prevB.hasDedicatedBackdrop ? prevB.url : '');
      const updatedItem: MediaItem = {
        ...item,
        poster: nextPoster,
        poster_url: nextPoster,
        backdrop_url: nextBackdrop,
        backdrop: nextBackdrop || item.backdrop,
        poster_width: resolved.poster_width || item.poster_width || 0,
        poster_height: resolved.poster_height || item.poster_height || 0,
        backdrop_width: resolved.backdrop_width || item.backdrop_width || 0,
        backdrop_height: resolved.backdrop_height || item.backdrop_height || 0,
        image_source: resolved.image_source || 'tmdb',
        image_quality_status: resolved.image_quality_status,
      };
      await saveMediaToFirestore(updatedItem, user.uid, false);
      onNotify(`تم تحديث وحفظ صور "${item.title}" بجودة عالية!`);
      setSinglePreview(null);
    } catch {
      onNotify('تعذر حفظ صور العمل — تحقق من صلاحيات Firestore.');
    } finally {
      setSavingSingle(false);
    }
  };

  const openManualModal = (item: MediaItem) => {
    const p = getPosterUrl(item);
    const bInfo = getBackdropInfo(item);
    setManualModalItem(item);
    setManualPosterUrl(p);
    setManualBackdropUrl(bInfo.hasDedicatedBackdrop ? bInfo.url : '');
    setManualDims({
      pw: item.poster_width || 0,
      ph: item.poster_height || 0,
      bw: item.backdrop_width || 0,
      bh: item.backdrop_height || 0,
      measured: Boolean(item.poster_width || item.backdrop_width),
    });
  };

  const handleProbeManualUrls = async () => {
    setProbingManual(true);
    try {
      const upPoster = upgradeKnownImageUrl(manualPosterUrl.trim());
      const upBackdrop = upgradeKnownImageUrl(manualBackdropUrl.trim());
      if (upPoster !== manualPosterUrl.trim()) setManualPosterUrl(upPoster);
      if (upBackdrop !== manualBackdropUrl.trim()) setManualBackdropUrl(upBackdrop);

      const [pRes, bRes] = await Promise.all([
        upPoster ? probeImageDimensionsInBrowser(upPoster) : Promise.resolve(null),
        upBackdrop ? probeImageDimensionsInBrowser(upBackdrop) : Promise.resolve(null),
      ]);

      setManualDims({
        pw: pRes?.ok ? pRes.width : 0,
        ph: pRes?.ok ? pRes.height : 0,
        bw: bRes?.ok ? bRes.width : 0,
        bh: bRes?.ok ? bRes.height : 0,
        measured: true,
      });

      if (bRes?.ok && bRes.width <= bRes.height) {
        onNotify(
          `تنبيه: رابط الخلفية أبعاده (${bRes.width}×${bRes.height}) وهي طولية وليست أفقية 16:9!`
        );
      } else {
        onNotify('تم فحص الأبعاد الفعلية للروابط.');
      }
    } finally {
      setProbingManual(false);
    }
  };

  const handleSaveManualModal = async () => {
    if (!manualModalItem) return;
    if (!isFirestoreSeeded) {
      onNotify('يرجى استيراد الكتالوج إلى Firestore أولاً لحفظ التغييرات.');
      return;
    }
    setSavingManual(true);
    try {
      const cleanPoster = upgradeKnownImageUrl(manualPosterUrl.trim()) || getPosterUrl(manualModalItem);
      const cleanBackdrop = upgradeKnownImageUrl(manualBackdropUrl.trim());

      const [pProbe, bProbe] = await Promise.all([
        probeImageDimensionsInBrowser(cleanPoster),
        cleanBackdrop ? probeImageDimensionsInBrowser(cleanBackdrop) : Promise.resolve(null),
      ]);

      if (bProbe?.ok && bProbe.width <= bProbe.height) {
        onNotify(
          `لا يمكن اعتماد خلفية طولية (${bProbe.width}×${bProbe.height}) لمساحة 16:9 — اختر صورة أفقية أعرض من ارتفاعها.`
        );
        setSavingManual(false);
        return;
      }

      const pw = pProbe.ok ? pProbe.width : manualDims.pw;
      const ph = pProbe.ok ? pProbe.height : manualDims.ph;
      const bw = bProbe?.ok ? bProbe.width : manualDims.bw;
      const bh = bProbe?.ok ? bProbe.height : manualDims.bh;

      const status = evaluateImageQuality({
        posterUrl: cleanPoster,
        backdropUrl: cleanBackdrop,
        posterWidth: pw,
        posterHeight: ph,
        backdropWidth: bw,
        backdropHeight: bh,
      });

      const updated: MediaItem = {
        ...manualModalItem,
        poster: cleanPoster,
        poster_url: cleanPoster,
        backdrop_url: cleanBackdrop,
        backdrop: cleanBackdrop || manualModalItem.backdrop,
        poster_width: pw,
        poster_height: ph,
        backdrop_width: cleanBackdrop ? bw : 0,
        backdrop_height: cleanBackdrop ? bh : 0,
        image_source: 'manual',
        image_quality_status: status,
      };
      await saveMediaToFirestore(updated, user.uid, false);
      onNotify(`تم حفظ البوستر والخلفية يدوياً لـ "${manualModalItem.title}".`);
      setManualModalItem(null);
    } catch {
      onNotify('تعذر حفظ تعديل الصور.');
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & KPI Stats */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-white flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#D92321]/20 border border-[#D92321]/40 text-[#D92321]">
                <ImageIcon className="w-5 h-5" />
              </span>
              <span>إدارة وفحص جودة الصور (بوستر 2:3 + خلفية 16:9)</span>
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              قياس الأبعاد الفعلية للصور وفصل البوستر الطولي عن الخلفية العريضة للسلايدر مع ترقية الأعمال القديمة أو الضعيفة بدون المساس ببيانات الفيلم.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={scanningAll || catalog.length === 0}
              onClick={() => void handleScanDimensions(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e] hover:bg-sky-500/20 border border-sky-400/35 disabled:opacity-50 px-4 py-2.5 text-xs font-extrabold text-sky-300 cursor-pointer"
            >
              {scanningAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Ruler className="w-4 h-4" />
              )}
              <span>
                {scanningAll
                  ? `فحص الأبعاد (${scanProgress.done}/${scanProgress.total})`
                  : 'فحص الأبعاد الفعلية للكل'}
              </span>
            </button>

            <button
              type="button"
              disabled={batchUpgrading || catalog.length === 0}
              onClick={() => void handlePrepareBatchUpgrade()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#f40612] disabled:opacity-50 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
            >
              {batchUpgrading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              <span>
                {batchUpgrading
                  ? `جاري الجلب (${batchProgress.done}/${batchProgress.total})`
                  : 'ترقية الصور الناقصة والضعيفة'}
              </span>
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-2xl border p-3.5 text-right transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white/10 border-white/30'
                : 'bg-[#1a242e]/60 border-white/[0.06] hover:border-white/20'
            }`}
          >
            <p className="text-[11px] font-bold text-[#b7c9ef]">إجمالي الأعمال</p>
            <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
              {stats.total}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('high')}
            className={`rounded-2xl border p-3.5 text-right transition-colors cursor-pointer ${
              statusFilter === 'high'
                ? 'bg-[#4CAF50]/20 border-[#4CAF50]'
                : 'bg-[#1a242e]/60 border-white/[0.06] hover:border-[#4CAF50]/40'
            }`}
          >
            <p className="text-[11px] font-bold text-[#4CAF50]">جودة عالية HD/4K</p>
            <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
              {stats.high}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('missing_backdrop')}
            className={`rounded-2xl border p-3.5 text-right transition-colors cursor-pointer ${
              statusFilter === 'missing_backdrop'
                ? 'bg-[#f9c400]/20 border-[#f9c400]'
                : 'bg-[#1a242e]/60 border-white/[0.06] hover:border-[#f9c400]/40'
            }`}
          >
            <p className="text-[11px] font-bold text-[#f9c400]">بدون خلفية 16:9</p>
            <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
              {stats.missingBackdrop}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('low')}
            className={`rounded-2xl border p-3.5 text-right transition-colors cursor-pointer ${
              statusFilter === 'low'
                ? 'bg-[#D92321]/20 border-[#D92321]'
                : 'bg-[#1a242e]/60 border-white/[0.06] hover:border-[#D92321]/40'
            }`}
          >
            <p className="text-[11px] font-bold text-[#ff8a88]">دقة منخفضة</p>
            <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
              {stats.low}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('unknown')}
            className={`rounded-2xl border p-3.5 text-right transition-colors cursor-pointer ${
              statusFilter === 'unknown'
                ? 'bg-sky-500/20 border-sky-400'
                : 'bg-[#1a242e]/60 border-white/[0.06] hover:border-sky-400/40'
            }`}
          >
            <p className="text-[11px] font-bold text-sky-300">غير مقاس فعلياً</p>
            <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
              {stats.unknown}
            </p>
          </button>
        </div>

        {/* Search & Filter Row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#D92321] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم العمل أو المصدر (tmdb / tvmaze / scraped)..."
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-4 py-2.5 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'issues', label: 'التي تحتاج تحسين فقط' },
                { id: 'missing_backdrop', label: 'ناقص خلفية عريضة' },
                { id: 'low', label: 'دقة منخفضة' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`rounded-xl px-3.5 py-2 text-xs font-extrabold border transition-colors cursor-pointer ${
                  statusFilter === f.id
                    ? 'bg-[#D92321] border-[#D92321] text-white'
                    : 'bg-[#1a242e] border-white/10 text-[#b7c9ef] hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Visual Dual-Image Cards Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filteredRows.map(({ item, status, posterUrl, backdropInfo }) => {
          const badge = IMAGE_QUALITY_BADGE_MAP[status];
          const isBusy = fetchingItemId === item.id;
          return (
            <div
              key={item.id}
              className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-sm font-extrabold text-white truncate">
                    {item.title}
                  </h3>
                  <p className="font-latin text-[11px] text-[#b7c9ef] truncate">
                    {item.englishTitle} • {item.year} • المصدر: {item.image_source || 'legacy'}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-black shrink-0 ${badge.badgeClass}`}
                >
                  {status === 'high' ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : status === 'missing_backdrop' || status === 'low' ? (
                    <AlertTriangle className="w-3 h-3" />
                  ) : (
                    <Ruler className="w-3 h-3" />
                  )}
                  <span>{badge.label}</span>
                </span>
              </div>

              {/* Side-by-Side Poster (2:3) vs Backdrop (16:9) */}
              <div className="grid grid-cols-12 gap-3 items-stretch">
                {/* Portrait Poster 2:3 */}
                <div className="col-span-4 space-y-1.5">
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-[#181818] border border-white/10">
                    <img
                      src={posterUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={handlePosterError}
                      className="h-full w-full object-cover object-top"
                    />
                    <span className="font-latin absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      2:3
                    </span>
                  </div>
                  <p className="font-latin text-[10px] font-bold text-[#b7c9ef] text-center tabular-nums">
                    {item.poster_width && item.poster_height
                      ? `${item.poster_width} × ${item.poster_height}`
                      : 'الأبعاد غير مقاسة'}
                  </p>
                </div>

                {/* Landscape Backdrop 16:9 */}
                <div className="col-span-8 flex flex-col justify-between space-y-1.5">
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#12161b] border border-white/10 flex items-center justify-center">
                    {backdropInfo.hasDedicatedBackdrop ? (
                      <>
                        <img
                          src={backdropInfo.url}
                          alt={`خلفية ${item.title}`}
                          referrerPolicy="no-referrer"
                          onError={handleBackdropError}
                          className="h-full w-full object-cover object-center"
                        />
                        <span className="font-latin absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          16:9
                        </span>
                      </>
                    ) : (
                      <div className="p-4 text-center space-y-1.5">
                        <AlertTriangle className="w-6 h-6 text-[#f9c400] mx-auto" />
                        <p className="text-[11px] font-extrabold text-[#f9c400]">
                          {backdropInfo.isPortraitMismatch
                            ? 'تم حظر خلفية طولية غير صالحة للبانر'
                            : 'لا توجد خلفية عريضة (16:9) مخصصة'}
                        </p>
                        <p className="text-[10px] text-[#b7c9ef]/75">
                          اضغط "إعادة جلب صور عالية الجودة" أو أضف خلفية عريضة يدوياً
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="font-latin text-[10px] font-bold text-[#b7c9ef] text-center tabular-nums">
                    {backdropInfo.hasDedicatedBackdrop &&
                    item.backdrop_width &&
                    item.backdrop_height
                      ? `${item.backdrop_width} × ${item.backdrop_height}`
                      : backdropInfo.hasDedicatedBackdrop
                        ? 'خلفية مخصصة (اضغط فحص الأبعاد)'
                        : 'بدون خلفية 16:9'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06]">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleFetchHqForItem(item)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/40 disabled:opacity-50 px-3 py-2 text-[11px] font-extrabold text-white transition-colors cursor-pointer"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isBusy ? 'جاري البحث والقياس...' : 'إعادة جلب صور بجودة عالية'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => openManualModal(item)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-2 text-[11px] font-bold text-white transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#f9c400]" />
                  <span>تعديل البوستر / الخلفية يدوياً</span>
                </button>
              </div>
            </div>
          );
        })}

        {filteredRows.length === 0 && (
          <div className="xl:col-span-2 rounded-3xl bg-[#0c1821] border border-white/10 p-12 text-center space-y-2">
            <ImageIcon className="w-10 h-10 text-[#b7c9ef]/30 mx-auto" />
            <p className="text-sm font-bold text-white">لا توجد أعمال مطابقة للتصفية الحالية</p>
          </div>
        )}
      </div>

      {/* Single Item HQ Fetch Preview Modal */}
      {singlePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-sm"
            onClick={() => !savingSingle && setSinglePreview(null)}
          />
          <div className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl bg-[#0c1821] border border-white/15 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#1a242e] px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#f9c400]" />
                <h3 className="font-display text-sm sm:text-base font-extrabold text-white">
                  معاينة الصور الجديدة قبل الحفظ — {singlePreview.item.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSinglePreview(null)}
                className="h-8 w-8 rounded-xl bg-white/10 text-white hover:bg-[#D92321] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* New Portrait Poster */}
                <div className="rounded-2xl bg-[#1a242e]/60 border border-white/10 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white">البوستر (2:3)</span>
                    <span className="font-latin rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-bold text-[#4CAF50]">
                      {singlePreview.resolved.poster_width > 0
                        ? `${singlePreview.resolved.poster_width} × ${singlePreview.resolved.poster_height}`
                        : 'غير متاح'}
                    </span>
                  </div>
                  <div className="aspect-[2/3] w-44 mx-auto overflow-hidden rounded-xl bg-black border border-white/15">
                    <img
                      src={singlePreview.resolved.poster_url || getPosterUrl(singlePreview.item)}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover object-top"
                    />
                  </div>
                  <p className="font-latin text-[10px] text-[#b7c9ef] break-all" dir="ltr">
                    {singlePreview.resolved.poster_url || 'لم يُعثر على بوستر أحدث — سيتم الاحتفاظ بالقديم'}
                  </p>
                </div>

                {/* New Landscape Backdrop */}
                <div className="rounded-2xl bg-[#1a242e]/60 border border-white/10 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white">الخلفية العريضة (16:9)</span>
                    <span className="font-latin rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-bold text-[#f9c400]">
                      {singlePreview.resolved.backdrop_width > 0
                        ? `${singlePreview.resolved.backdrop_width} × ${singlePreview.resolved.backdrop_height}`
                        : 'غير متوفرة'}
                    </span>
                  </div>
                  <div className="aspect-video w-full overflow-hidden rounded-xl bg-black border border-white/15 flex items-center justify-center">
                    {singlePreview.resolved.backdrop_url ? (
                      <img
                        src={singlePreview.resolved.backdrop_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover object-center"
                      />
                    ) : (
                      <span className="text-xs font-bold text-[#f9c400] px-4 text-center">
                        لم يتم العثور على خلفية أفقية 16:9 من المصادر التلقائية — يمكنك إضافتها يدوياً أو ضبط TMDB_API_KEY
                      </span>
                    )}
                  </div>
                  <p className="font-latin text-[10px] text-[#b7c9ef] break-all" dir="ltr">
                    {singlePreview.resolved.backdrop_url || '—'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-[#1a242e]/50 border border-white/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#b7c9ef]">
                  المصدر المكتشف: <strong className="text-white font-latin">{singlePreview.resolved.image_source}</strong>
                </span>
                <span className="text-[#b7c9ef]">
                  التقييم بعد القياس:{' '}
                  <strong className="text-white">
                    {IMAGE_QUALITY_BADGE_MAP[singlePreview.resolved.image_quality_status].label}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 bg-[#1a242e] px-5 py-3.5 border-t border-white/10">
              <button
                type="button"
                disabled={savingSingle}
                onClick={() => setSinglePreview(null)}
                className="rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white cursor-pointer"
              >
                إلغاء (الإبقاء على القديمة)
              </button>
              <button
                type="button"
                disabled={savingSingle}
                onClick={() => void handleApplySinglePreview()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{savingSingle ? 'جاري الحفظ...' : 'اعتماد وحفظ الصور'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Upgrade Review Modal */}
      {batchCandidates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-sm"
            onClick={() => !savingBatch && setBatchCandidates(null)}
          />
          <div className="relative z-10 w-full max-w-5xl max-h-[90vh] flex flex-col rounded-3xl bg-[#0c1821] border border-white/15 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#1a242e] px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="font-display text-sm sm:text-base font-extrabold text-white">
                  مراجعة ترقية الصور للأعمال الضعيفة / الناقصة ({batchCandidates.length})
                </h3>
                <p className="text-[11px] text-[#b7c9ef]">
                  سيتم تحديث حقول الصور فقط دون تعديل العناوين أو السيرفرات أو المواسم.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBatchCandidates(null)}
                className="h-8 w-8 rounded-xl bg-white/10 text-white hover:bg-[#D92321] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {batchCandidates.map((cand, idx) => (
                <div
                  key={cand.item.id}
                  className="rounded-2xl bg-[#1a242e]/65 border border-white/10 p-3.5 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <input
                    type="checkbox"
                    checked={cand.selected}
                    onChange={() =>
                      setBatchCandidates((prev) =>
                        prev
                          ? prev.map((entry, eIdx) =>
                              eIdx === idx ? { ...entry, selected: !entry.selected } : entry
                            )
                          : null
                      )
                    }
                    className="h-4 w-4 accent-[#4CAF50] cursor-pointer shrink-0"
                  />

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-extrabold text-white truncate">{cand.item.title}</p>
                    <p className="font-latin text-[11px] text-[#b7c9ef]">
                      البوستر: {cand.beforePw || '?'}×{cand.beforePh || '?'} ←{' '}
                      <strong className="text-[#4CAF50]">
                        {cand.resolved.poster_width || '?'}×{cand.resolved.poster_height || '?'}
                      </strong>{' '}
                      | الخلفية: {cand.beforeBw ? `${cand.beforeBw}×${cand.beforeBh}` : 'مفقودة'} ←{' '}
                      <strong className="text-[#f9c400]">
                        {cand.resolved.backdrop_width
                          ? `${cand.resolved.backdrop_width}×${cand.resolved.backdrop_height}`
                          : 'بدون'}
                      </strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <img
                      src={cand.resolved.poster_url || cand.beforePoster}
                      alt=""
                      className="h-16 w-11 rounded-lg object-cover object-top border border-white/15"
                    />
                    {cand.resolved.backdrop_url && (
                      <img
                        src={cand.resolved.backdrop_url}
                        alt=""
                        className="h-16 w-28 rounded-lg object-cover object-center border border-[#4CAF50]/50"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2.5 bg-[#1a242e] px-5 py-3.5 border-t border-white/10">
              <button
                type="button"
                disabled={savingBatch}
                onClick={() => setBatchCandidates(null)}
                className="rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={savingBatch}
                onClick={() => void handleConfirmBatchUpgrade()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {savingBatch
                    ? 'جاري الحفظ...'
                    : `اعتماد وحفظ (${batchCandidates.filter((c) => c.selected).length})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Dual Image Editor Modal */}
      {manualModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-sm"
            onClick={() => !savingManual && setManualModalItem(null)}
          />
          <div className="relative z-10 w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl bg-[#0c1821] border border-white/15 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#1a242e] px-5 py-4 border-b border-white/10">
              <h3 className="font-display text-sm sm:text-base font-extrabold text-white">
                تعديل صور العمل يدوياً — {manualModalItem.title}
              </h3>
              <button
                type="button"
                onClick={() => setManualModalItem(null)}
                className="h-8 w-8 rounded-xl bg-white/10 text-white hover:bg-[#D92321] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className="md:col-span-4 space-y-2">
                  <label className="block text-xs font-bold text-[#b7c9ef]">
                    معاينة البوستر الطولي (2:3)
                  </label>
                  <div className="aspect-[2/3] w-36 mx-auto overflow-hidden rounded-xl bg-black border border-white/15">
                    <img
                      src={manualPosterUrl || getPosterUrl(manualModalItem)}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={handlePosterError}
                      className="h-full w-full object-cover object-top"
                    />
                  </div>
                  <p className="font-latin text-[10px] text-center text-[#b7c9ef]">
                    {manualDims.pw && manualDims.ph ? `${manualDims.pw} × ${manualDims.ph}` : '—'}
                  </p>
                </div>

                <div className="md:col-span-8 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                      رابط البوستر الطولي (Poster URL - 2:3)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={manualPosterUrl}
                      onChange={(e) => setManualPosterUrl(e.target.value)}
                      placeholder="https://image.tmdb.org/t/p/original/..."
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                      رابط الخلفية العريضة للسلايدر (Backdrop URL - 16:9)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={manualBackdropUrl}
                      onChange={(e) => setManualBackdropUrl(e.target.value)}
                      placeholder="https://image.tmdb.org/t/p/original/..."
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                    />
                  </div>

                  <div className="aspect-video w-full overflow-hidden rounded-xl bg-black border border-white/15 flex items-center justify-center">
                    {manualBackdropUrl.trim() ? (
                      <img
                        src={manualBackdropUrl.trim()}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={handleBackdropError}
                        className="h-full w-full object-cover object-center"
                      />
                    ) : (
                      <span className="text-xs text-[#b7c9ef]/60">
                        أدخل رابط صورة عريضة (أفقية 16:9 مثل 1920×1080)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="font-latin text-[11px] text-[#b7c9ef]">
                      أبعاد الخلفية: {manualDims.bw && manualDims.bh ? `${manualDims.bw} × ${manualDims.bh}` : 'غير مقاسة'}
                    </span>
                    <button
                      type="button"
                      disabled={probingManual}
                      onClick={() => void handleProbeManualUrls()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/35 px-3 py-1.5 text-[11px] font-bold text-sky-200 cursor-pointer"
                    >
                      {probingManual ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                      <span>قياس الأبعاد وترقية الرابط</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 bg-[#1a242e] px-5 py-3.5 border-t border-white/10">
              <button
                type="button"
                disabled={savingManual}
                onClick={() => setManualModalItem(null)}
                className="rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={savingManual}
                onClick={() => void handleSaveManualModal()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{savingManual ? 'جاري التحقق والحفظ...' : 'حفظ الصور'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
