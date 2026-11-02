import type { DuplicateMatch } from '@ims/shared';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/ui/StatusBadge';

/** Non-blocking warning listing records that share this phone or email. */
export function DuplicateWarning({ matches, onUseStudent }: { matches: DuplicateMatch[] | undefined; onUseStudent?: (match: DuplicateMatch) => void }) {
  if (!matches || matches.length === 0) return null;
  return (
    <div role="status" className="space-y-2 rounded-control border border-warning/35 bg-warning-soft p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <TriangleAlert aria-hidden className="size-4 text-warning" />
        Possible duplicate{matches.length > 1 ? 's' : ''} found
      </p>
      <ul className="space-y-1.5">
        {matches.map((match) => (
          <li key={`${match.kind}-${match.id}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-fg-subtle uppercase">{match.kind}</span>
            {match.kind === 'student' ? (
              <Link to={`/students/${match.id}`} className="font-medium text-primary hover:underline" target="_blank">
                {match.name}
              </Link>
            ) : (
              <Link to={`/leads?lead=${match.id}`} className="font-medium text-primary hover:underline" target="_blank">
                {match.name}
              </Link>
            )}
            <span className="font-mono text-xs text-fg-muted">{match.code}</span>
            <span className="text-xs text-fg-subtle">same {match.matchedOn.join(' & ')}</span>
            {match.status && <StatusBadge status={match.status} />}
            {onUseStudent && match.kind === 'student' && (
              <button type="button" className="ml-auto text-xs font-medium text-primary hover:underline" onClick={() => onUseStudent(match)}>
                Use this student
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
