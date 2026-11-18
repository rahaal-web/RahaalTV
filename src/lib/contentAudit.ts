// Pure static/runtime catalog audit engine for detecting real data-quality issues
// across movies, series, seasons, episodes, images, and watch servers.

import { MediaItem, MediaKind } from '../types/media';

export type AuditSeverity = 'critical' | 'warning' | 'info';

export type AuditIssueCategory =
  | 'duplicate'
  | 'missing_media_assets'
  | 'zero_servers'
  | 'suspicious_server_url'
  | 'incomplete_episodes'
  | 'missing_metadata';

export interface ContentAuditFinding {
  id: string;
  mediaId: string;
  title: string;
  englishTitle?: string;
  kind: MediaKind;
  category: AuditIssueCategory;
  severity: AuditSeverity;
  summary: string;
  details: string;
}

export interface ContentAuditReport {
  scannedCount: number;
  healthyCount: number;
  findings: ContentAuditFinding[];
  countsByCategory: Record<AuditIssueCategory, number>;
  countsBySeverity: Record<AuditSeverity, number>;
}

export function normalizeTitleForDuplicateCheck(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractServerResolvedUrl(srv?: {
  url?: string;
  embedCode?: string;
}): string {
  if (!srv) return '';
  const direct = (srv.url || '').trim();
  if (direct) return direct;
  const embed = (srv.embedCode || '').trim();
  const srcMatch = embed.match(/src\s*=\s*["']([^"']+)["']/i);
  if (srcMatch?.[1]) return srcMatch[1].trim();
  if (/^https?:\/\//i.test(embed)) return embed;
  return '';
}

export function isSuspiciousServerUrl(url: string): boolean {
  const raw = (url || '').trim();
  if (!raw) return true;
  if (!/^https?:\/\//i.test(raw)) return true;
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.toLowerCase();
    if (path === '/' && !parsed.search && !parsed.hash) {
      return true;
    }
    if (/\/(category|tag|genre|search|login|register|feed)(\/|$)/i.test(path)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function runCatalogContentAudit(media: MediaItem[]): ContentAuditReport {
  const findings: ContentAuditFinding[] = [];
  const unhealthyMediaIds = new Set<string>();

  const countsByCategory: Record<AuditIssueCategory, number> = {
    duplicate: 0,
    missing_media_assets: 0,
    zero_servers: 0,
    suspicious_server_url: 0,
    incomplete_episodes: 0,
    missing_metadata: 0,
  };

  const countsBySeverity: Record<AuditSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };

  const addFinding = (finding: Omit<ContentAuditFinding, 'id'>) => {
    const id = `${finding.mediaId}_${finding.category}_${findings.length}`;
    findings.push({ id, ...finding });
    unhealthyMediaIds.add(finding.mediaId);
    countsByCategory[finding.category] += 1;
    countsBySeverity[finding.severity] += 1;
  };

  // 1. Duplicate title + kind + year detection
  const duplicateMap = new Map<string, MediaItem[]>();
  for (const item of media) {
    const norm = normalizeTitleForDuplicateCheck(item.title || item.englishTitle);
    if (!norm) continue;
    const key = `${item.kind}::${norm}::${item.year || 'na'}`;
    const bucket = duplicateMap.get(key) || [];
    bucket.push(item);
    duplicateMap.set(key, bucket);
  }

  for (const [, group] of duplicateMap.entries()) {
    if (group.length > 1) {
      for (const item of group) {
        addFinding({
          mediaId: item.id,
          title: item.title,
          englishTitle: item.englishTitle,
          kind: item.kind,
          category: 'duplicate',
          severity: 'warning',
          summary: `تكرار محتمل (${group.length} نسخ)`,
          details: `يوجد ${group.length} أعمال بنفس الاسم والنوع والسنة (${item.year || 'غير محدد'}).`,
        });
      }
    }
  }

  // 2. Per-item inspection
  for (const item of media) {
    const hasPoster = Boolean((item.poster_url || item.poster || '').trim());
    const hasBackdrop = Boolean((item.backdrop_url || item.backdrop || '').trim());
    if (!hasPoster || !hasBackdrop) {
      addFinding({
        mediaId: item.id,
        title: item.title,
        englishTitle: item.englishTitle,
        kind: item.kind,
        category: 'missing_media_assets',
        severity: !hasPoster ? 'critical' : 'info',
        summary: !hasPoster ? 'بوستر مفقود' : 'خلفية العرض (Backdrop) مفقودة',
        details: !hasPoster
          ? 'العنصر يفتقد رابط صورة البوستر الرئيسية.'
          : 'العنصر يفتقد صورة الخلفية الواسعة المستخدمة في السلايدر وصفحة التفاصيل.',
      });
    }

    // Missing metadata
    const missingMetaParts: string[] = [];
    if (!item.story || item.story.trim().length < 15) {
      missingMetaParts.push('القصة/الوصف');
    }
    if (!item.year || !/^\d{4}$/.test(String(item.year))) {
      missingMetaParts.push('سنة الإصدار');
    }
    if (!item.genres || item.genres.length === 0) {
      missingMetaParts.push('التصنيفات');
    }
    if (missingMetaParts.length > 0) {
      addFinding({
        mediaId: item.id,
        title: item.title,
        englishTitle: item.englishTitle,
        kind: item.kind,
        category: 'missing_metadata',
        severity: 'info',
        summary: `بيانات ناقصة: ${missingMetaParts.join('، ')}`,
        details: `الحقول التالية فارغة أو غير مكتملة: ${missingMetaParts.join('، ')}.`,
      });
    }

    // Servers & episodes check
    const hasSeasons = Array.isArray(item.seasons) && item.seasons.length > 0;
    if (item.kind === 'movie' || !hasSeasons) {
      const servers = Array.isArray(item.servers) ? item.servers : [];
      if (servers.length === 0 && item.kind === 'movie') {
        addFinding({
          mediaId: item.id,
          title: item.title,
          englishTitle: item.englishTitle,
          kind: item.kind,
          category: 'zero_servers',
          severity: 'critical',
          summary: 'فيلم بدون أي سيرفر مشاهدة',
          details: 'لا يحتوي هذا الفيلم على أي سيرفر تشغيل حالياً.',
        });
      } else if (servers.length > 0) {
        const badServers = servers.filter((s) =>
          isSuspiciousServerUrl(extractServerResolvedUrl(s))
        );
        if (badServers.length > 0) {
          addFinding({
            mediaId: item.id,
            title: item.title,
            englishTitle: item.englishTitle,
            kind: item.kind,
            category: 'suspicious_server_url',
            severity: 'warning',
            summary: `${badServers.length} سيرفر بروابط مشبوهة`,
            details: `أسماء السيرفرات: ${badServers.map((s) => s.name || 'سيرفر').join('، ')}`,
          });
        }
      } else if (item.kind === 'series' && !hasSeasons) {
        addFinding({
          mediaId: item.id,
          title: item.title,
          englishTitle: item.englishTitle,
          kind: item.kind,
          category: 'incomplete_episodes',
          severity: 'critical',
          summary: 'مسلسل بدون مواسم أو حلقات',
          details: 'لا توجد أي مواسم أو حلقات مضافة داخل هذا المسلسل.',
        });
      }
    } else {
      const seasons = item.seasons || [];
      const totalEpisodes = seasons.reduce(
        (sum, season) => sum + (Array.isArray(season.episodes) ? season.episodes.length : 0),
        0
      );

      if (totalEpisodes === 0) {
        addFinding({
          mediaId: item.id,
          title: item.title,
          englishTitle: item.englishTitle,
          kind: item.kind,
          category: 'incomplete_episodes',
          severity: 'critical',
          summary: 'مسلسل بدون حلقات',
          details: 'المواسم موجودة ولكن لا تحتوي على أي حلقات حالياً.',
        });
      } else {
        let zeroServerEpisodes = 0;
        let suspiciousEpisodesServers = 0;
        const gapNotes: string[] = [];
        const fallbackParentServers = Array.isArray(item.servers) ? item.servers : [];

        for (const season of seasons) {
          const eps = Array.isArray(season.episodes) ? season.episodes : [];
          const nums = eps
            .map((e) => Number(e.number))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b);

          if (nums.length >= 2) {
            const missingNums: number[] = [];
            const maxNum = nums[nums.length - 1];
            const numSet = new Set(nums);
            for (let n = 1; n <= maxNum; n++) {
              if (!numSet.has(n)) missingNums.push(n);
            }
            if (missingNums.length > 0 && missingNums.length <= 20) {
              gapNotes.push(`موسم ${season.seasonNumber}: ناقص (${missingNums.join(', ')})`);
            } else if (missingNums.length > 20) {
              gapNotes.push(`موسم ${season.seasonNumber}: ${missingNums.length} حلقة مفقودة`);
            }
          }

          for (const ep of eps) {
            const epServers =
              Array.isArray(ep.servers) && ep.servers.length > 0
                ? ep.servers
                : fallbackParentServers;
            const hasDirectWatch = Boolean((ep.watchUrl || '').trim() || (ep.embedCode || '').trim());

            if (epServers.length === 0 && !hasDirectWatch) {
              zeroServerEpisodes += 1;
            } else {
              const badEpSrv = epServers.some((s) =>
                isSuspiciousServerUrl(extractServerResolvedUrl(s))
              );
              const badEpUrl = ep.watchUrl ? isSuspiciousServerUrl(ep.watchUrl) : false;
              if (badEpSrv || badEpUrl) {
                suspiciousEpisodesServers += 1;
              }
            }
          }
        }

        if (gapNotes.length > 0) {
          addFinding({
            mediaId: item.id,
            title: item.title,
            englishTitle: item.englishTitle,
            kind: item.kind,
            category: 'incomplete_episodes',
            severity: 'warning',
            summary: 'فجوات في تسلسل الحلقات',
            details: gapNotes.join(' | '),
          });
        }

        if (zeroServerEpisodes > 0) {
          addFinding({
            mediaId: item.id,
            title: item.title,
            englishTitle: item.englishTitle,
            kind: item.kind,
            category: 'zero_servers',
            severity: 'critical',
            summary: `${zeroServerEpisodes} حلقة بدون سيرفرات`,
            details: `يوجد ${zeroServerEpisodes} حلقة لا تحتوي على أي رابط تشغيل.`,
          });
        }

        if (suspiciousEpisodesServers > 0) {
          addFinding({
            mediaId: item.id,
            title: item.title,
            englishTitle: item.englishTitle,
            kind: item.kind,
            category: 'suspicious_server_url',
            severity: 'warning',
            summary: `${suspiciousEpisodesServers} حلقة تحتوي على روابط مشبوهة`,
            details: 'تأكد من أن الروابط تشير لمشغل فيديو مباشر وليس لصفحات أقسام.',
          });
        }
      }
    }
  }

  return {
    scannedCount: media.length,
    healthyCount: Math.max(0, media.length - unhealthyMediaIds.size),
    findings,
    countsByCategory,
    countsBySeverity,
  };
}
