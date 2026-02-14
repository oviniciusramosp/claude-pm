// panel/src/components/connection-dot.tsx

export function ConnectionDot({ pulse = false }: { pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2">
      {pulse ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-35" /> : null}
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}
