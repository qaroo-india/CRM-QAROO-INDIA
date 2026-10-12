import { LEAD_PRIORITIES, LEAD_STATUSES, type LeadDetail, type LeadDto } from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { CalendarDays, Columns3 as BoardIcon, Download, FileUp, List, Megaphone, Plus, UserPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { fetchFile, saveBlob, toQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { ImportDialog } from '../import/ImportDialog';
import { date, getFormatConfig, humanize } from '@/utils/format';
import { todayInZone } from '@ims/shared';
import { toOptions, useActionParam, useCourses, useLeadSources, useUserOptions } from '../shared/hooks';
import { useAssignLeads, useLeads } from './api';
import { FollowUpCalendar } from './FollowUpCalendar';
import { LeadBoard } from './LeadBoard';
import { LeadDetailDrawer } from './LeadDetailDrawer';
import { LeadFormDrawer } from './LeadFormDrawer';

type View = 'list' | 'board' | 'calendar';
const FILTERS = ['status', 'sourceId', 'courseId', 'counsellorId', 'priority', 'followUp', 'from', 'to'] as const;

const VIEWS: { key: View; label: string; icon: typeof List }[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'board', label: 'Pipeline', icon: BoardIcon },
  { key: 'calendar', label: 'Follow-ups', icon: CalendarDays },
];

export function LeadsPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useListParams(FILTERS, { sort: { key: 'enquiryDate', order: 'desc' } });
  const view = (params.get('view') as View | null) ?? 'list';
  const openLeadId = params.get('lead');

  const sources = useLeadSources();
  const courses = useCourses();
  const people = useUserOptions();
  const assign = useAssignLeads();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LeadDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const exportLeads = useMutation({
    mutationFn: (format: 'xlsx' | 'csv') => fetchFile(`/leads/export${toQuery({ ...list.query, page: undefined, limit: undefined, format })}`, { fallbackName: `leads.${format}` }),
    onSuccess: saveBlob,
    onError: (e) => toastError(e),
  });

  const leads = useLeads(list.query, view === 'list');
  const canWrite = auth.can('leads:write');
  const today = todayInZone(getFormatConfig().timeZone);

  const setView = (next: View) =>
    setParams((current) => {
      const p = new URLSearchParams(current);
      if (next === 'list') p.delete('view');
      else p.set('view', next);
      return p;
    });

  const openLead = (id: string | null) =>
    setParams((current) => {
      const p = new URLSearchParams(current);
      if (id) p.set('lead', id);
      else p.delete('lead');
      return p;
    });

  const openNew = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);
  useActionParam('new', openNew);

  // The board and calendar show every status themselves.
  const { status: _status, ...nonStatusQuery } = list.query as Record<string, unknown>;

  const columns: Column<LeadDto>[] = [
    {
      id: 'name',
      header: 'Lead',
      sortKey: 'name',
      hideable: false,
      cell: (l) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{l.name}</p>
          <p className="truncate text-xs text-fg-subtle">{l.phone}{l.email ? ` · ${l.email}` : ''}</p>
        </div>
      ),
    },
    { id: 'status', header: 'Status', sortKey: 'status', cell: (l) => <StatusBadge status={l.status} /> },
    { id: 'source', header: 'Source', cell: (l) => <span className="text-fg-muted">{l.sourceName}</span> },
    { id: 'course', header: 'Course', cell: (l) => <span className="text-fg-muted">{l.courseName ?? '—'}</span> },
    { id: 'counsellor', header: 'Counsellor', cell: (l) => <span className="text-fg-muted">{l.counsellorName ?? 'Unassigned'}</span> },
    {
      id: 'followUp',
      header: 'Follow-up',
      sortKey: 'followUpDate',
      cell: (l) => {
        if (!l.followUpDate) return <span className="text-fg-subtle">—</span>;
        const overdue = l.followUpDate < today && !['converted', 'lost', 'not_interested', 'unreachable'].includes(l.status);
        return <span className={cn('tabular-nums', overdue ? 'font-medium text-danger' : 'text-fg-muted')}>{overdue ? 'Overdue · ' : ''}{date(l.followUpDate)}</span>;
      },
    },
    {
      id: 'priority',
      header: 'Priority',
      sortKey: 'priority',
      cell: (l) => <Badge tone={l.priority === 'high' ? 'danger' : l.priority === 'medium' ? 'warning' : 'neutral'}>{humanize(l.priority)}</Badge>,
    },
    { id: 'enquiryDate', header: 'Enquired', sortKey: 'enquiryDate', cell: (l) => <span className="text-fg-muted tabular-nums">{date(l.enquiryDate)}</span> },
    { id: 'code', header: 'Code', defaultHidden: true, cell: (l) => <span className="font-mono text-xs text-fg-subtle">{l.leadCode}</span> },
    { id: 'campaign', header: 'Campaign', defaultHidden: true, cell: (l) => <span className="text-fg-muted">{l.campaignName ?? '—'}</span> },
  ];
  const visibility = useColumnVisibility('leads', columns);

  return (
    <>
      <PageHeader
        title="Enquiries & leads"
        description="Capture every enquiry with its source, work the pipeline, and never miss a follow-up."
        breadcrumbs={[{ label: 'Growth' }, { label: 'Enquiries & leads' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {auth.can('leads:export') && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" loading={exportLeads.isPending}><Download aria-hidden className="size-4" /> Export</Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => exportLeads.mutate('xlsx')}>Excel (.xlsx), current filters</MenuItem>
                  <MenuItem onSelect={() => exportLeads.mutate('csv')}>CSV, current filters</MenuItem>
                </MenuContent>
              </Menu>
            )}
            {auth.can('data:import') && canWrite && <Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp aria-hidden className="size-4" /> Import</Button>}
            {canWrite && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New enquiry</Button>}
          </div>
        }
      />

      <div role="tablist" aria-label="Lead views" className="mb-4 inline-flex rounded-control border bg-surface p-1">
        {VIEWS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              view === key ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name, phone, email or code" />
        {view === 'list' && (
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={LEAD_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        )}
        <FilterSelect label="Source" value={list.filters.sourceId} onChange={(v) => list.setFilter('sourceId', v)} options={toOptions(sources.data)} />
        <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(courses.data)} />
        <FilterSelect
          label="Counsellor"
          value={list.filters.counsellorId}
          onChange={(v) => list.setFilter('counsellorId', v)}
          options={[{ value: 'unassigned', label: 'Unassigned' }, ...toOptions(people.data)]}
        />
        <FilterSelect label="Priority" value={list.filters.priority} onChange={(v) => list.setFilter('priority', v)} options={LEAD_PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
        {view !== 'calendar' && (
          <FilterSelect
            label="Follow-up"
            value={list.filters.followUp}
            onChange={(v) => list.setFilter('followUp', v)}
            options={[
              { value: 'overdue', label: 'Overdue' },
              { value: 'today', label: 'Due today' },
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'none', label: 'Not scheduled' },
            ]}
          />
        )}
        <DateFilter label="Enquired from" value={list.filters.from} onChange={(v) => list.setFilter('from', v)} max={list.filters.to || undefined} />
        <DateFilter label="to" value={list.filters.to} onChange={(v) => list.setFilter('to', v)} min={list.filters.from || undefined} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        {view === 'list' && (
          <div className="ml-auto flex items-center gap-2">
            {auth.can('leads:assign') && selected.size > 0 && (
              <Button variant="secondary" size="sm" className="h-9" onClick={() => setAssignOpen(true)}>
                <UserPlus aria-hidden className="size-4" /> Assign {selected.size}
              </Button>
            )}
            <ColumnToggle columns={columns} visibility={visibility} />
          </div>
        )}
      </Toolbar>

      {view === 'list' && (
        <>
          <DataTable
            caption="Leads"
            columns={columns}
            visibility={visibility}
            rows={leads.data?.items}
            rowKey={(l) => l.id}
            loading={leads.isPending}
            fetching={leads.isFetching}
            error={leads.error}
            onRetry={() => void leads.refetch()}
            sort={list.sort}
            onSortChange={list.setSort}
            onRowClick={(l) => openLead(l.id)}
            selection={auth.can('leads:assign') ? { selected, onChange: setSelected } : undefined}
            empty={
              <EmptyState
                icon={Megaphone}
                title={list.isFiltered ? 'No enquiries match these filters' : 'No enquiries yet'}
                description={list.isFiltered ? 'Try widening the filters or clearing the search.' : 'Record your first enquiry to start the pipeline.'}
                action={canWrite && !list.isFiltered ? <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New enquiry</Button> : undefined}
              />
            }
          />
          {leads.data && (
            <Pagination page={leads.data.page} totalPages={leads.data.totalPages} total={leads.data.total} limit={leads.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />
          )}
        </>
      )}
      {view === 'board' && <LeadBoard query={nonStatusQuery} onOpenLead={openLead} />}
      {view === 'calendar' && <FollowUpCalendar query={nonStatusQuery} onOpenLead={openLead} />}

      <LeadDetailDrawer
        leadId={openLeadId}
        onOpenChange={(open) => !open && openLead(null)}
        onEdit={(lead: LeadDetail) => {
          setEditing(lead);
          setFormOpen(true);
        }}
      />
      <LeadFormDrawer lead={editing} open={formOpen} onOpenChange={setFormOpen} onSaved={(lead) => !editing && openLead(lead.id)} />

      <DialogRoot open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent
          title={`Assign ${selected.size} lead${selected.size === 1 ? '' : 's'}`}
          description="Each lead's timeline records the reassignment."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button
                disabled={!assignee}
                loading={assign.isPending}
                onClick={() =>
                  assign.mutate(
                    { leadIds: [...selected], counsellorId: assignee },
                    { onSuccess: () => { setAssignOpen(false); setSelected(new Set()); setAssignee(''); } },
                  )
                }
              >
                Assign
              </Button>
            </>
          }
        >
          <Field label="Counsellor" required>
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} options={toOptions(people.data)} placeholder="Choose a counsellor…" />
          </Field>
        </DialogContent>
      </DialogRoot>
      <ImportDialog entity="leads" open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
