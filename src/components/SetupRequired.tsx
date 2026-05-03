import Link from 'next/link';
import { Settings, AlertCircle } from 'lucide-react';

interface Props {
  /** Project name for the heading. */
  project: string;
  /** Tailwind text color class for the accent (e.g., 'text-violet-300'). */
  accent?: string;
  /** Tailwind border color class for the accent. */
  accentBorder?: string;
  /** Human-readable list of missing config items. */
  missing: string[];
  /** Anchor on /setup that addresses the most prominent missing item. */
  setupAnchor?: string | null;
}

/**
 * Empty-state card shown on a project page when its required external
 * services / paths are not yet configured. Lists exactly what's missing
 * and links to the relevant /setup section.
 */
export default function SetupRequired({
  project, missing, setupAnchor, accent = 'text-amber-300', accentBorder = 'border-amber-500/30',
}: Props) {
  const href = setupAnchor ? `/setup#${setupAnchor}` : '/setup';
  return (
    <div className="min-h-[calc(100vh-57px)] flex items-center justify-center p-6">
      <div className={`max-w-lg w-full rounded-2xl border ${accentBorder} bg-black/30 backdrop-blur p-8`}>
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className={`h-5 w-5 ${accent}`} />
          <h1 className={`text-xl font-bold ${accent}`}>Setup required</h1>
        </div>
        <p className="text-white/70 mb-4">
          {project} needs a few more pieces before it can run.
        </p>
        <ul className="space-y-2 mb-6">
          {missing.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-white/60">
              <span className={`mt-1 h-1.5 w-1.5 rounded-full ${accent} bg-current shrink-0`} />
              <span>{m}</span>
            </li>
          ))}
        </ul>
        <Link
          href={href}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${accentBorder} ${accent} hover:bg-white/[0.03] transition-colors text-sm font-medium`}
        >
          <Settings className="h-4 w-4" />
          Open setup
        </Link>
      </div>
    </div>
  );
}
