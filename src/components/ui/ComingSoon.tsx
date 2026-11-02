import { Construction } from 'lucide-react';
import { EmptyState } from './Feedback';
import { PageHeader } from './PageHeader';

/** Temporary placeholder while a module is being built. */
export function ComingSoon({ title, milestone }: { title: string; milestone: number }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title={`${title} arrives in Milestone ${milestone}`} description="This module is under construction." />
    </>
  );
}
