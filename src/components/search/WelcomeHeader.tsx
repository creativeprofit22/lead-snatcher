'use client';

const TEXT = 'LEAD SNATCHER';
const SLOGAN = 'Snatch Leads Before They Know';

export function WelcomeHeader() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 text-center">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-sky-400/85">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/70 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
          </span>
          Live
        </span>
        <span className="h-4 w-px bg-border-bright/60" />
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">
          B2B · Lead Engine
        </span>
      </div>
      <h1 className="font-orbitron text-4xl font-bold tracking-wider text-white drop-shadow-[0_0_24px_rgba(56,189,248,0.15)] sm:text-5xl md:text-6xl lg:text-7xl">
        {TEXT}
      </h1>
      <p className="font-orbitron text-sm tracking-[0.24em] text-white/55 sm:text-base">{SLOGAN}</p>
    </div>
  );
}
