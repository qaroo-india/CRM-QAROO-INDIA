import {
  EMPLOYMENT_TYPES,
  ROLES,
  createUserSchema,
  type CreateUserInput,
  type Permission,
  type UserSummary,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Copy, KeyRound, MoreHorizontal, Pencil, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { sessionQueryKey, useAuth } from '@/auth/AuthProvider';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { photoKey, UserAvatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, FormSection } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Checkbox } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api, toQuery, upload } from '@/lib/api';
import { handleFormError, toastError, useZodForm } from '@/lib/forms';
import { humanize, relative } from '@/utils/format';
import { generateTemporaryPassword, PERMISSION_GROUPS } from './permissionGroups';

const usersKey = ['users'] as const;

function PermissionMatrix({ value, onChange, disabled }: { value: string[]; onChange: (next: Permission[]) => void; disabled?: boolean }) {
  const set = new Set(value);
  const toggle = (permission: Permission) => {
    const next = new Set(set);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange([...next] as Permission[]);
  };
  const toggleGroup = (permissions: Permission[], on: boolean) => {
    const next = new Set(set);
    permissions.forEach((p) => (on ? next.add(p) : next.delete(p)));
    onChange([...next] as Permission[]);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PERMISSION_GROUPS.map((group) => {
        const values = group.permissions.map((p) => p.value);
        const count = values.filter((p) => set.has(p)).length;
        return (
          <div key={group.key} className="rounded-control border bg-surface-sunken p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-fg">{group.label}</span>
              <Checkbox
                aria-label={`All ${group.label} permissions`}
                disabled={disabled}
                checked={count === values.length ? true : count > 0 ? 'indeterminate' : false}
                onCheckedChange={() => toggleGroup(values, count !== values.length)}
              />
            </div>
            <div className="space-y-1.5">
              {group.permissions.map((permission) => (
                <Checkbox
                  key={permission.value}
                  id={`perm-${permission.value}`}
                  disabled={disabled}
                  checked={set.has(permission.value)}
                  onCheckedChange={() => toggle(permission.value)}
                  label={<span className="text-fg-muted">{permission.label}</span>}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TemporaryPasswordNotice({ password, name }: { password: string; name: string }) {
  return (
    <div className="space-y-2 rounded-control border border-warning/30 bg-warning-soft p-3">
      <p className="text-sm text-fg">
        Share this temporary password with {name} privately. It is shown only once, and they must change it at first sign-in.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded border bg-surface px-2 py-1.5 font-mono text-sm text-fg">{password}</code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(password).then(() => toast.success('Copied'))}
          aria-label="Copy password"
        >
          <Copy aria-hidden className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Upload a profile photo for oneself, or (with users:write) for anyone. */
export function PhotoPicker({ user }: { user: Pick<UserSummary, 'id' | 'name' | 'hasPhoto'> }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData();
      data.set('file', file);
      return upload(`/users/${user.id}/photo`, data);
    },
    onSuccess: () => {
      toast.success('Photo updated');
      void queryClient.invalidateQueries({ queryKey: photoKey(user.id) });
      void queryClient.invalidateQueries({ queryKey: usersKey });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
    onError: (error) => toastError(error),
  });
  const hasPhoto = user.hasPhoto || save.isSuccess;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <UserAvatar userId={user.id} name={user.name} hasPhoto={hasPhoto} className="size-14 text-base" />
      <Button type="button" variant="secondary" size="sm" loading={save.isPending} onClick={() => fileRef.current?.click()}>
        <Camera aria-hidden className="size-4" /> {hasPhoto ? 'Change photo' : 'Add photo'}
      </Button>
      <span className="text-xs text-fg-subtle">PNG, JPG or WEBP, up to 2 MB</span>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Profile photo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) save.mutate(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function UserDrawer({ user, open, onOpenChange }: { user: UserSummary | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const isEdit = !!user;
  const [issued, setIssued] = useState<{ password: string; name: string } | null>(null);

  // Computed once per opening: a fresh random password must not regenerate
  // on every render (that would reset the form while the owner types).
  const defaults = useMemo<CreateUserInput>(
    () =>
      user
        ? {
            name: user.name,
            email: user.email,
            phone: user.phone ?? undefined,
            role: user.role,
            permissions: user.permissions.filter((p) => p !== '*') as Permission[],
            // Placeholder that satisfies the schema; edits never send a password.
            temporaryPassword: 'Unchanged-Password-0',
            staffCode: user.staffCode ?? '',
            designation: user.designation ?? '',
            department: user.department ?? '',
            employmentType: (user.employmentType ?? '') as CreateUserInput['employmentType'],
            joinedOn: user.joinedOn ?? '',
            specialisation: user.specialisation ?? '',
            bio: user.bio ?? '',
          }
        : { name: '', email: '', role: 'staff', permissions: [], temporaryPassword: generateTemporaryPassword(), staffCode: '', designation: '', department: '', employmentType: '', joinedOn: '', specialisation: '', bio: '' },
    // `open` is a deliberate dependency: each opening gets a fresh password.
    [user, open],
  );
  const form = useZodForm(createUserSchema, { defaultValues: defaults });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);
  const role = form.watch('role');

  const save = useMutation({
    mutationFn: (values: CreateUserInput) =>
      isEdit
        ? api.patch<UserSummary>(`/users/${user.id}`, {
            name: values.name,
            phone: values.phone ?? null,
            role: values.role,
            permissions: values.permissions,
            staffCode: values.staffCode,
            designation: values.designation,
            department: values.department,
            employmentType: values.employmentType,
            joinedOn: values.joinedOn,
            specialisation: values.specialisation,
            bio: values.bio,
          })
        : api.post<UserSummary>('/users', values),
    onSuccess: (saved, values) => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
      toast.success(isEdit ? 'Access updated' : 'Staff member added');
      if (!isEdit) setIssued({ password: values.temporaryPassword, name: saved.name });
      else onOpenChange(false);
    },
    onError: (error) => handleFormError(form, error),
  });

  const close = (next: boolean) => {
    if (!next) setIssued(null);
    onOpenChange(next);
  };

  return (
    <DialogRoot open={open} onOpenChange={close}>
      <DrawerContent
        title={isEdit ? `Edit ${user.name}` : 'Add staff member'}
        description={isEdit ? 'Changes apply on their next request.' : 'They will set their own password at first sign-in.'}
        width="xl"
        dismissible={false}
        footer={
          issued ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={form.handleSubmit((values) => save.mutate(values as CreateUserInput))}>
                {isEdit ? 'Save changes' : 'Add staff member'}
              </Button>
            </>
          )
        }
      >
        {issued ? (
          <TemporaryPasswordNotice password={issued.password} name={issued.name} />
        ) : (
          <form className="space-y-6" noValidate onSubmit={(e) => e.preventDefault()}>
            <FormSection title="Details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" error={form.formState.errors.name?.message} required>
                  <Input {...form.register('name')} />
                </Field>
                <Field label="Email" error={form.formState.errors.email?.message} required>
                  <Input type="email" readOnly={isEdit} {...form.register("email")} />
                </Field>
                <Field label="Phone" error={form.formState.errors.phone?.message}>
                  <Input type="tel" {...form.register('phone', { setValueAs: (v: string) => (v === '' ? undefined : v) })} />
                </Field>
                <Field label="Role" error={form.formState.errors.role?.message} required>
                  <Select
                    options={ROLES.map((r) => ({ value: r, label: r === 'owner' ? 'Owner / Admin' : 'Staff', disabled: r === 'owner' && (!auth.isOwner || (isEdit && user.accountType !== 'team')) }))}
                    disabled={isEdit && (user.id === auth.user?.id || user.accountType !== 'team')}
                    {...form.register('role')}
                  />
                </Field>
              </div>
              {!isEdit && (
                <Field label="Temporary password" hint="Generated for you; edit it if you prefer." error={form.formState.errors.temporaryPassword?.message} required>
                  <Input
                    className="font-mono"
                    trailing={
                      <button
                        type="button"
                        className="rounded px-2 text-xs text-primary hover:underline"
                        onClick={() => form.setValue('temporaryPassword', generateTemporaryPassword(), { shouldValidate: true })}
                      >
                        Regenerate
                      </button>
                    }
                    {...form.register('temporaryPassword')}
                  />
                </Field>
              )}
            </FormSection>

            <FormSection title="Work profile" description="Shown on their profile. The staff code must be unique.">
              {isEdit && <PhotoPicker user={user} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Staff code" error={form.formState.errors.staffCode?.message}>
                  <Input placeholder="EMP-014" {...form.register('staffCode')} />
                </Field>
                <Field label="Designation" error={form.formState.errors.designation?.message}>
                  <Input placeholder="Senior trainer" {...form.register('designation')} />
                </Field>
                <Field label="Department" error={form.formState.errors.department?.message}>
                  <Input placeholder="Academics" {...form.register('department')} />
                </Field>
                <Field label="Employment" error={form.formState.errors.employmentType?.message}>
                  <Select placeholder="Not set" options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} {...form.register('employmentType')} />
                </Field>
                <Field label="Joined on" error={form.formState.errors.joinedOn?.message}>
                  <Input type="date" {...form.register('joinedOn')} />
                </Field>
                <Field label="Specialisation" error={form.formState.errors.specialisation?.message}>
                  <Input placeholder="Data science, Python" {...form.register('specialisation')} />
                </Field>
                <Field label="Short bio" error={form.formState.errors.bio?.message} className="sm:col-span-2">
                  <Textarea rows={3} {...form.register('bio')} />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Permissions"
              description={role === 'owner' ? 'Owners have full access to everything.' : 'Choose exactly what this person may see and do.'}
            >
              {role === 'owner' ? (
                <div className="flex items-center gap-2 rounded-control border border-primary/30 bg-primary-soft p-3 text-sm text-primary">
                  <ShieldCheck aria-hidden className="size-4" /> Full access
                </div>
              ) : (
                <Controller
                  control={form.control}
                  name="permissions"
                  render={({ field }) => <PermissionMatrix value={field.value ?? []} onChange={field.onChange} />}
                />
              )}
            </FormSection>
          </form>
        )}
      </DrawerContent>
    </DialogRoot>
  );
}

export function StaffPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const list = useListParams(['role', 'active', 'accountType'] as const, { sort: { key: 'name', order: 'asc' } });
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ user: UserSummary; action: 'deactivate' | 'reactivate' } | null>(null);
  const [reset, setReset] = useState<{ user: UserSummary; password: string; done: boolean } | null>(null);

  const users = useQuery({
    queryKey: [...usersKey, list.q, list.filters],
    queryFn: () => api.get<UserSummary[]>(`/users${toQuery({ q: list.q, ...list.filters })}`),
    placeholderData: (previous) => previous,
  });

  const toggleActive = useMutation({
    mutationFn: ({ user, action }: { user: UserSummary; action: 'deactivate' | 'reactivate' }) => api.post(`/users/${user.id}/${action}`),
    onSuccess: (_d, { action }) => {
      toast.success(action === 'deactivate' ? 'Account deactivated and signed out' : 'Account reactivated');
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
    onError: (error) => toastError(error),
  });

  const resetPassword = useMutation({
    mutationFn: ({ user, password }: { user: UserSummary; password: string }) =>
      api.post(`/users/${user.id}/reset-password`, { temporaryPassword: password }),
    onSuccess: () => {
      setReset((current) => (current ? { ...current, done: true } : current));
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
    onError: (error) => toastError(error),
  });

  const canWrite = auth.can('users:write');

  const columns: Column<UserSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar userId={u.id} name={u.name} hasPhoto={u.hasPhoto} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">
              {u.name} {u.id === auth.user?.id && <span className="text-xs font-normal text-fg-subtle">(you)</span>}
            </p>
            <p className="truncate text-xs text-fg-subtle">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (u) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={u.role === 'owner' ? 'violet' : u.accountType === 'faculty' ? 'primary' : 'neutral'}>{u.role === 'owner' ? 'Owner' : u.accountType === 'faculty' ? 'Faculty' : 'Staff'}</Badge>
          {u.designation && <span className="text-xs text-fg-subtle">{u.designation}</span>}
        </div>
      ),
    },
    { id: 'profile', header: 'Department', defaultHidden: true, cell: (u) => <span className="text-sm text-fg-muted">{[u.staffCode, u.department, u.employmentType ? humanize(u.employmentType) : null].filter(Boolean).join(' · ') || '—'}</span> },
    {
      id: 'access',
      header: 'Access',
      cell: (u) => (u.role === 'owner' ? <span className="text-sm text-fg-muted">Full access</span> : <span className="text-sm text-fg-muted">{u.permissions.length} permissions</span>),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (u) =>
        !u.isActive ? (
          <StatusBadge status="cancelled" label="Deactivated" />
        ) : u.mustChangePassword ? (
          <StatusBadge status="pending" label="Awaiting first sign-in" />
        ) : (
          <StatusBadge status="active" />
        ),
    },
    { id: 'lastLogin', header: 'Last sign-in', cell: (u) => <span className="text-sm text-fg-muted">{u.lastLoginAt ? relative(u.lastLoginAt) : 'Never'}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (u) =>
        canWrite && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${u.name}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Pencil />} onSelect={() => { setEditing(u); setDrawerOpen(true); }}>
                Edit details &amp; access
              </MenuItem>
              <MenuItem icon={<KeyRound />} disabled={u.id === auth.user?.id} onSelect={() => setReset({ user: u, password: generateTemporaryPassword(), done: false })}>
                Issue temporary password
              </MenuItem>
              <MenuSeparator />
              {u.isActive ? (
                <MenuItem icon={<UserX />} tone="danger" disabled={u.id === auth.user?.id} onSelect={() => setConfirm({ user: u, action: 'deactivate' })}>
                  Deactivate
                </MenuItem>
              ) : (
                <MenuItem icon={<UserCheck />} onSelect={() => setConfirm({ user: u, action: 'reactivate' })}>
                  Reactivate
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        ),
    },
  ];

  const visibility = useColumnVisibility('staff', columns);

  return (
    <>
      <PageHeader
        title="Staff & permissions"
        description="Who can sign in, and exactly what each person may see and do."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Staff & permissions' }]}
        actions={
          canWrite && (
            <Button onClick={() => { setEditing(null); setDrawerOpen(true); }}>
              <Plus aria-hidden className="size-4" /> Add staff member
            </Button>
          )
        }
      />

      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name or email" />
        <FilterSelect label="Role" value={list.filters.role} onChange={(v) => list.setFilter('role', v)} options={[{ value: 'owner', label: 'Owner' }, { value: 'staff', label: 'Staff' }]} />
        <FilterSelect label="Account" value={list.filters.accountType} onChange={(v) => list.setFilter('accountType', v)} options={[{ value: 'team', label: 'Office team' }, { value: 'faculty', label: 'Faculty' }]} />
        <FilterSelect label="Status" value={list.filters.active} onChange={(v) => list.setFilter('active', v)} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Deactivated' }]} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        <div className="ml-auto">
          <ColumnToggle columns={columns} visibility={visibility} />
        </div>
      </Toolbar>

      <DataTable
        caption="Staff accounts"
        columns={columns}
        visibility={visibility}
        rows={users.data}
        rowKey={(u) => u.id}
        loading={users.isPending}
        fetching={users.isFetching}
        error={users.error}
        onRetry={() => void users.refetch()}
        onRowClick={canWrite ? (u) => { setEditing(u); setDrawerOpen(true); } : undefined}
        empty={<EmptyState compact title={list.isFiltered ? 'No staff match these filters' : 'No staff yet'} />}
      />

      <UserDrawer user={editing} open={drawerOpen} onOpenChange={setDrawerOpen} />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.action === 'deactivate' ? `Deactivate ${confirm.user.name}?` : `Reactivate ${confirm?.user.name}?`}
        description={
          confirm?.action === 'deactivate'
            ? 'They are signed out everywhere immediately and cannot sign in until reactivated. Their past records stay intact.'
            : 'They will be able to sign in again with their existing password.'
        }
        tone={confirm?.action === 'deactivate' ? 'danger' : 'default'}
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        loading={toggleActive.isPending}
        onConfirm={() => confirm && toggleActive.mutate(confirm)}
      />

      <DialogRoot open={!!reset} onOpenChange={(open) => !open && setReset(null)}>
        <DialogContent
          title={`Temporary password for ${reset?.user.name ?? ''}`}
          description="Their current sessions end, and they must choose a new password at next sign-in."
          size="sm"
          footer={
            reset?.done ? (
              <Button onClick={() => setReset(null)}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setReset(null)}>
                  Cancel
                </Button>
                <Button loading={resetPassword.isPending} onClick={() => reset && resetPassword.mutate({ user: reset.user, password: reset.password })}>
                  Issue password
                </Button>
              </>
            )
          }
        >
          {reset && <TemporaryPasswordNotice password={reset.password} name={reset.user.name} />}
        </DialogContent>
      </DialogRoot>
    </>
  );
}
