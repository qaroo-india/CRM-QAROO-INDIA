import { courseFormSchema, toDecimalString, type CourseDto, type CourseInput } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, FormSection } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Switch } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { humanize, money, number } from '@/utils/format';
import { useActionParam, useCourses } from '../shared/hooks';

const TRACKS = [
  { value: 'technical', label: 'Technical' },
  { value: 'non_technical', label: 'Non-technical' },
  { value: 'both', label: 'Both tracks' },
];

function CourseDrawer({ course, open, onOpenChange }: { course: CourseDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const defaults = useMemo(
    () =>
      course
        ? {
            code: course.code,
            name: course.name,
            description: course.description ?? '',
            durationWeeks: course.durationWeeks ?? '',
            standardFeeMinor: toDecimalString(course.standardFeeMinor),
            defaultAdmissionFeeMinor: course.defaultAdmissionFeeMinor === null ? '' : toDecimalString(course.defaultAdmissionFeeMinor),
            defaultInstalmentCount: course.defaultInstalmentCount ?? '',
            modules: course.modules,
            placementTrack: course.placementTrack ?? '',
            isActive: course.isActive,
          }
        : { code: '', name: '', description: '', durationWeeks: '', standardFeeMinor: '', defaultAdmissionFeeMinor: '', defaultInstalmentCount: '', modules: [], placementTrack: '', isActive: true },
    [course],
  );
  const form = useZodForm(courseFormSchema, { defaultValues: defaults as never });
  useEffect(() => {
    if (open) form.reset(defaults as never);
  }, [open, defaults, form]);

  const save = useMutation({
    mutationFn: (values: CourseInput) => (course ? api.put<CourseDto>(`/courses/${course.id}`, values) : api.post<CourseDto>('/courses', values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['courses'] });
      toast.success(course ? 'Course updated' : 'Course created');
      onOpenChange(false);
    },
    onError: (error) => handleFormError(form, error),
  });

  const errors = form.formState.errors;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={course ? `Edit ${course.name}` : 'New course'}
        description="Fees are entered in rupees and stored to the exact paisa."
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((values) => save.mutate(values as CourseInput))}>
              {course ? 'Save course' : 'Create course'}
            </Button>
          </>
        }
      >
        <form noValidate className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <FormSection title="Course">
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <Field label="Code" error={errors.code?.message} required>
                <Input className="font-mono uppercase" {...form.register('code')} />
              </Field>
              <Field label="Name" error={errors.name?.message} required>
                <Input {...form.register('name')} />
              </Field>
            </div>
            <Field label="Description" error={errors.description?.message}>
              <Textarea {...form.register('description')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Duration (weeks)" error={errors.durationWeeks?.message}>
                <Input type="number" min={1} {...form.register('durationWeeks')} />
              </Field>
              <Field label="Placement support" error={errors.placementTrack?.message}>
                <Select options={TRACKS} placeholder="No placement support" {...form.register('placementTrack')} />
              </Field>
            </div>
            <Controller
              control={form.control}
              name="modules"
              render={({ field }) => (
                <Field label="Modules" hint="One per line.">
                  <Textarea
                    rows={4}
                    defaultValue={(field.value ?? []).join('\n')}
                    onBlur={(e) => field.onChange(e.target.value.split('\n').map((m) => m.trim()).filter(Boolean))}
                  />
                </Field>
              )}
            />
          </FormSection>

          <FormSection title="Fees" description="The defaults pre-fill new admissions; each admission can still differ.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Standard fee" error={errors.standardFeeMinor?.message} required>
                <MoneyInput {...form.register('standardFeeMinor')} />
              </Field>
              <Field label="Default admission fee" error={errors.defaultAdmissionFeeMinor?.message}>
                <MoneyInput {...form.register('defaultAdmissionFeeMinor')} />
              </Field>
              <Field label="Default instalments" error={errors.defaultInstalmentCount?.message}>
                <Input type="number" min={0} max={60} {...form.register('defaultInstalmentCount')} />
              </Field>
            </div>
          </FormSection>

          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Switch id="course-active" checked={!!field.value} onCheckedChange={field.onChange} label="Accepting admissions" description="Inactive courses stay on past admissions and reports." />
            )}
          />
        </form>
      </DrawerContent>
    </DialogRoot>
  );
}

export function CoursesPage() {
  const auth = useAuth();
  const canWrite = auth.can('courses:write');
  const [params] = useSearchParams();
  const list = useListParams(['active', 'track'] as const, { sort: { key: 'name', order: 'asc' } });
  const courses = useCourses();
  const [editing, setEditing] = useState<CourseDto | null>(null);
  const [open, setOpen] = useState(false);

  const openNew = useCallback(() => {
    setEditing(null);
    setOpen(true);
  }, []);
  useActionParam('new', openNew);

  // Deep link from search: /courses?course=<id>
  const focusId = params.get('course');
  useEffect(() => {
    if (!focusId || !courses.data || !canWrite) return;
    const match = courses.data.find((c) => c.id === focusId);
    if (match) {
      setEditing(match);
      setOpen(true);
    }
  }, [focusId, courses.data, canWrite]);

  const rows = useMemo(() => {
    const q = list.q.toLowerCase();
    return courses.data?.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) &&
        (!list.filters.active || String(c.isActive) === list.filters.active) &&
        (!list.filters.track || c.placementTrack === list.filters.track),
    );
  }, [courses.data, list.q, list.filters]);

  const columns: Column<CourseDto>[] = [
    {
      id: 'name',
      header: 'Course',
      hideable: false,
      cell: (c) => (
        <div>
          <p className="font-medium text-fg">{c.name}</p>
          <p className="font-mono text-xs text-fg-subtle">{c.code}</p>
        </div>
      ),
    },
    { id: 'fee', header: 'Standard fee', align: 'right', cell: (c) => <span className="tabular-nums">{money(c.standardFeeMinor, { compactDecimals: true })}</span> },
    { id: 'duration', header: 'Duration', cell: (c) => <span className="text-fg-muted">{c.durationWeeks ? `${c.durationWeeks} weeks` : '—'}</span> },
    { id: 'track', header: 'Placement', cell: (c) => (c.placementTrack ? <Badge tone="violet">{humanize(c.placementTrack)}</Badge> : <span className="text-fg-subtle">None</span>) },
    { id: 'modules', header: 'Modules', defaultHidden: true, cell: (c) => <span className="text-fg-muted">{c.modules.length}</span> },
    { id: 'live', header: 'Live admissions', align: 'right', cell: (c) => <span className="tabular-nums">{number(c.activeAdmissions)}</span> },
    { id: 'status', header: 'Status', cell: (c) => (c.isActive ? <StatusBadge status="active" label="Accepting" /> : <StatusBadge status="draft" label="Inactive" />) },
  ];
  const visibility = useColumnVisibility('courses', columns);

  return (
    <>
      <PageHeader
        title="Courses"
        description="The catalogue admissions are registered against, with default fees and placement support."
        breadcrumbs={[{ label: 'Growth' }, { label: 'Courses' }]}
        actions={canWrite && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New course</Button>}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name or code" />
        <FilterSelect label="Status" value={list.filters.active} onChange={(v) => list.setFilter('active', v)} options={[{ value: 'true', label: 'Accepting' }, { value: 'false', label: 'Inactive' }]} />
        <FilterSelect label="Placement" value={list.filters.track} onChange={(v) => list.setFilter('track', v)} options={TRACKS} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        <div className="ml-auto"><ColumnToggle columns={columns} visibility={visibility} /></div>
      </Toolbar>
      <DataTable
        caption="Courses"
        columns={columns}
        visibility={visibility}
        rows={rows}
        rowKey={(c) => c.id}
        loading={courses.isPending}
        error={courses.error}
        onRetry={() => void courses.refetch()}
        onRowClick={canWrite ? (c) => { setEditing(c); setOpen(true); } : undefined}
        empty={
          <EmptyState
            icon={BookOpen}
            title={list.isFiltered ? 'No courses match these filters' : 'No courses yet'}
            description={list.isFiltered ? undefined : 'Create your first course to start registering admissions.'}
            action={canWrite && !list.isFiltered ? <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New course</Button> : undefined}
          />
        }
      />
      <CourseDrawer course={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}
