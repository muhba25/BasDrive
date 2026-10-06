export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {!compact && (
        <span className="brand-text">
          Bas<span>Drive</span>
        </span>
      )}
    </div>
  );
}
