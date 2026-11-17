import { ArrowUp } from 'lucide-react';
import { Logo } from './Logo';

export type FooterTopic = 'terms' | 'privacy' | 'community' | 'requests';

interface FooterProps {
  tagline?: string;
  onOpenTopic: (topic: FooterTopic) => void;
  onNavigateHome: () => void;
}

export function Footer({ tagline, onOpenTopic, onNavigateHome }: FooterProps) {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="relative mt-16 bg-[#0c1821] border-t border-white/[0.08] pb-20 sm:pb-10 pt-12">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <button
            type="button"
            onClick={onNavigateHome}
            className="mb-4 cursor-pointer focus:outline-none"
            aria-label="العودة إلى الرئيسية - RahaL TV"
          >
            <Logo size="lg" />
          </button>

          <p className="max-w-2xl text-sm font-semibold leading-relaxed text-[#b7c9ef]">
            {tagline ||
              'افلام ومسلسلات بجودة عالية بدون تقطيع ، تحميل ومشاهدة افلام اجنبية بروابط مباشرة ، مسلسلات اجنبية ، مسلسلات رمضان 2026 وعروض المصارعة الحرة المترجمة.'}
          </p>

          <nav className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-6" aria-label="روابط الفوتر">
            <button
              type="button"
              onClick={() => onOpenTopic('terms')}
              className="text-xs sm:text-sm font-bold text-white/80 hover:text-[#D92321] transition-colors cursor-pointer"
            >
              سياسة الاستخدام
            </button>
            <span className="text-white/20">•</span>
            <button
              type="button"
              onClick={() => onOpenTopic('privacy')}
              className="text-xs sm:text-sm font-bold text-white/80 hover:text-[#D92321] transition-colors cursor-pointer"
            >
              سياسة الخصوصية
            </button>
            <span className="text-white/20">•</span>
            <button
              type="button"
              onClick={() => onOpenTopic('community')}
              className="text-xs sm:text-sm font-bold text-white/80 hover:text-[#D92321] transition-colors cursor-pointer"
            >
              مجتمعنا
            </button>
            <span className="text-white/20">•</span>
            <button
              type="button"
              onClick={() => onOpenTopic('requests')}
              className="text-xs sm:text-sm font-bold text-[#4CAF50] hover:text-white transition-colors cursor-pointer"
            >
              طلبات الزوار
            </button>
          </nav>

          <div className="mt-8 flex w-full flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/[0.07] pt-6">
            <p className="text-xs font-medium text-[#b7c9ef]/70">
              جميع الحقوق محفوظة لموقع <span className="font-bold text-white">RahaL TV</span> — واجهة
              سينمائية حديثة
            </p>

            {/* Green back-to-top button from source footer */}
            <button
              type="button"
              onClick={scrollToTop}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg transition-transform hover:-translate-y-0.5 cursor-pointer"
            >
              <span>عودة الي أعلي</span>
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
