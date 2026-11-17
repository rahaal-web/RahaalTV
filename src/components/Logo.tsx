interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export function Logo({ size = 'md', showSubtitle = false }: LogoProps) {
  const heightClass = size === 'lg' ? 'h-10' : size === 'sm' ? 'h-7' : 'h-8';

  return (
    <div className="inline-flex items-center gap-2.5 select-none whitespace-nowrap shrink-0">
      <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-[#E50914] shadow-[0_4px_16px_rgba(229,9,20,0.4)]">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-white fill-current" aria-hidden="true">
          <path d="M8 5.5v13l10-6.5-10-6.5z" />
        </svg>
      </div>
      <div className={`flex flex-col leading-none ${heightClass} justify-center`} dir="ltr">
        <span className="font-latin text-xl sm:text-2xl font-black tracking-tight text-white">
          RahaL <span className="text-[#E50914]">TV</span>
        </span>
        {showSubtitle && (
          <span
            className="text-[10px] font-semibold tracking-wide text-[#a3a3a3] text-right mt-0.5"
            dir="rtl"
          >
            سينما بلا حدود
          </span>
        )}
      </div>
    </div>
  );
}
