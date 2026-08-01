'use client';

// The ledger: every launch family on the books, ranked under the console's
// current dials. Lives inside the main screen, which provides the console
// housing and the scroll — the header row stays pinned while you dig.

import {
  familyColor,
  familyLabel,
  fmtTonnes,
  type Mode,
  type RankedFamily,
} from '../_lib/model';

export function FamilyLedger({
  ranked,
  colors,
  mode,
  maxYear,
}: {
  ranked: RankedFamily[];
  colors: Map<string, string>;
  mode: Mode;
  maxYear: number;
}) {
  const maxT = Math.max(ranked[0]?.t.tonnes ?? 0, 0.001);
  return (
    <table className="w-full min-w-[640px] border-collapse text-[12px]">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-border text-left">
          {[
            '#',
            'Family',
            'Span',
            'Flights',
            'Success',
            `Tonnes ${mode === 'delivered' ? 'to orbit' : 'launched'}`,
            't / yr',
          ].map((h) => (
            <th key={h} className="sf-etch bg-card py-2 pr-4 font-semibold shadow-[0_1px_0_var(--sf-line)]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ranked.map(({ f, t }, i) => {
          const span = t.lastYear - t.firstYear + 1;
          return (
            <tr key={f.key} className="border-b border-border last:border-b-0">
              <td className="sf-readout py-2 pr-4 text-muted-foreground">{i + 1}</td>
              <td className="py-2 pr-4">
                <span className="flex items-center gap-2 whitespace-nowrap text-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: familyColor(f, colors) }}
                  />
                  {familyLabel(f.key)}
                </span>
              </td>
              <td className="sf-readout whitespace-nowrap py-2 pr-4 text-muted-foreground">
                {t.firstYear}–{t.lastYear >= maxYear ? 'now' : t.lastYear}
              </td>
              <td className="sf-readout py-2 pr-4 text-foreground">
                {t.flights.toLocaleString('en-US')}
              </td>
              <td className="sf-readout py-2 pr-4 text-muted-foreground">
                {((t.successes / Math.max(t.flights, 1)) * 100).toFixed(1)}%
              </td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <span className="sf-readout w-[72px] shrink-0 text-right text-foreground">
                    {fmtTonnes(t.tonnes)}
                  </span>
                  <span className="h-1.5 w-[120px] shrink-0 overflow-hidden rounded-[2px] bg-muted">
                    <span
                      className="block h-full rounded-[2px]"
                      style={{
                        width: `${Math.max((t.tonnes / maxT) * 100, t.tonnes > 0 ? 1.5 : 0)}%`,
                        background: familyColor(f, colors),
                      }}
                    />
                  </span>
                </div>
              </td>
              <td className="sf-readout py-2 text-muted-foreground">
                {t.tonnes / span >= 0.05 ? (t.tonnes / span).toFixed(1) : '0'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
