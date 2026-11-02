import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchFile } from '@/lib/api';
import { cn } from '@/lib/cn';
import { initials } from '@/utils/format';

export const photoKey = (userId: string) => ['photo', userId] as const;

/**
 * A person's photo, or their initials. The photo is fetched through the API
 * client (cookies, CSRF and session refresh included) rather than a bare
 * <img src>, so it also works when the API is on another origin.
 */
export function UserAvatar({ userId, name, hasPhoto, className }: { userId: string; name: string; hasPhoto: boolean; className?: string }) {
  const photo = useQuery({
    queryKey: photoKey(userId),
    queryFn: async () => (await fetchFile(`/users/${userId}/photo`, { fallbackName: 'photo' })).blob,
    enabled: hasPhoto,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo.data) return setUrl(null);
    const next = URL.createObjectURL(photo.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.data]);

  return (
    <span className={cn('grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-primary/30 bg-primary-soft text-xs font-semibold text-primary', className)}>
      {url && hasPhoto ? <img src={url} alt="" className="size-full object-cover" /> : <span aria-hidden>{initials(name)}</span>}
    </span>
  );
}
