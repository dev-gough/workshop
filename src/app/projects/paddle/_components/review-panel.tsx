'use client';

// REVIEW view: the imagery flagger's queue. Each row is one contested
// stretch — the aerials say its kind is wrong. Selecting a row flies the
// map there (aerials pinned) and draws the proposal dashed over the
// current ribbon; the verdict buttons decide it. Approvals edit the
// network immediately and re-apply themselves after every re-ingest.

import type { ReviewItem } from '../_lib/model';
import { fmtKm } from '../_lib/model';

const KIND_VAR: Record<string, string> = {
  paddle: 'var(--pd-blue)',
  portage: 'var(--pd-red)',
  track: 'var(--pd-track)',
};

const STATUS_LABEL: Record<ReviewItem['status'], string> = {
  proposed: 'open',
  approved: 'approved',
  rejected: 'rejected',
  unclear: 'unclear',
};

interface ReviewPanelProps {
  reviews: ReviewItem[] | null;
  selectedId: number | null;
  onSelect: (r: ReviewItem) => void;
  onDecide: (r: ReviewItem, status: ReviewItem['status']) => void;
  busy: boolean;
}

export default function ReviewPanel({ reviews, selectedId, onSelect, onDecide, busy }: ReviewPanelProps) {
  if (!reviews) return <p className="pd-etch mt-1">consulting the aerials…</p>;
  const open = reviews.filter((r) => r.status === 'proposed');
  const decided = reviews.filter((r) => r.status !== 'proposed');
  const selected = reviews.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <p className="pd-etch">Imagery review</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Stretches where the aerials disagree with the chart&rsquo;s classification —{' '}
        <span className="pd-readout">{open.length}</span> open,{' '}
        <span className="pd-readout">{decided.length}</span> decided. Solid ribbon = as
        classified; dashed = as proposed.
      </p>

      {selected && (
        <div className="mt-2.5 border-t border-border pt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs">
              <span style={{ color: KIND_VAR[selected.before_kind] }}>{selected.before_kind}</span>
              {' → '}
              <span style={{ color: KIND_VAR[selected.pieces[0]?.kind ?? 'track'] }}>
                {selected.pieces[0]?.kind}
              </span>
            </span>
            <span className="pd-readout text-xs">{fmtKm(selected.evidence.lengthM)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            confidence {selected.evidence.confidence.toFixed(2)} · segment reads{' '}
            {Math.round(selected.evidence.waterFrac * 100)}% water over {selected.evidence.samples}{' '}
            samples
          </p>
          <div className="mt-2 flex gap-1.5">
            {(['approved', 'rejected', 'unclear'] as const).map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => onDecide(selected, s)}
                className={`flex-1 rounded-sm border px-2 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                  selected.status === s
                    ? 'border-primary text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'approved' ? 'approve' : s === 'rejected' ? 'reject' : 'unclear'}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5">
        {reviews.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onSelect(r)}
              className={`flex w-full items-baseline justify-between gap-2 rounded-sm border px-2 py-1.5 text-left text-xs transition-colors ${
                r.id === selectedId
                  ? 'border-primary'
                  : 'border-transparent hover:border-border'
              }`}
            >
              <span className="min-w-0 truncate">
                <span style={{ color: KIND_VAR[r.before_kind] }}>{r.before_kind}</span>
                <span className="text-muted-foreground"> → </span>
                <span style={{ color: KIND_VAR[r.pieces[0]?.kind ?? 'track'] }}>
                  {r.pieces[0]?.kind}
                </span>
                <span className="text-muted-foreground"> · {fmtKm(r.evidence.lengthM)}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="pd-readout text-[11px]">{r.evidence.confidence.toFixed(2)}</span>
                <span
                  className={`text-[10px] uppercase tracking-wide ${
                    r.status === 'proposed' ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {reviews.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Nothing flagged — run <span className="pd-readout">flag-imagery-kinds</span> after the
          next imagery import.
        </p>
      )}
    </>
  );
}
