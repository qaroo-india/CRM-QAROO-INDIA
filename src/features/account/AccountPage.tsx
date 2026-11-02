import type { UserSummary } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { ChangePasswordForm } from '@/auth/ChangePasswordPage';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api';
import { date, dateTime, humanize } from '@/utils/format';
import { usePortalOverview } from '../campus/api';
import { PhotoPicker } from '../staff/StaffPage';

const ACCOUNT_LABEL = { team: 'Office team', faculty: 'Faculty', student: 'Student' } as const;

function StudentDetails() {
  const overview = usePortalOverview();
  const s = overview.data?.student;
  if (!s) return null;
  return (
    <>
      <dt className="text-fg-subtle">Student ID</dt>
      <dd className="font-mono text-fg">{s.studentCode}</dd>
      <dt className="text-fg-subtle">Phone</dt>
      <dd className="text-fg">{s.phone}</dd>
    </>
  );
}

export function AccountPage() {
  const { user, accountType } = useAuth();
  const staff = accountType !== 'student';
  const me = useQuery({ queryKey: ['users', 'me'], queryFn: () => api.get<UserSummary>('/users/me'), enabled: staff });
  if (!user) return null;
  const permissions = user.permissions.includes('*') ? ['Full access'] : user.permissions;
  const profile = me.data;
  const rows: [string, string | null | undefined][] = profile
    ? [
        ['Staff code', profile.staffCode],
        ['Designation', profile.designation],
        ['Department', profile.department],
        ['Employment', profile.employmentType ? humanize(profile.employmentType) : null],
        ['Joined', profile.joinedOn ? date(profile.joinedOn) : null],
        ['Specialisation', profile.specialisation],
      ]
    : [];

  return (
    <>
      <PageHeader title={staff ? 'Account & password' : 'My profile'} description="Your profile and sign-in security." breadcrumbs={[{ label: 'Account' }]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Profile</CardTitle>
              <CardDescription>{staff ? 'Your details are managed by the institute owner. You can change your photo.' : 'To correct your details, contact the institute office.'}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {staff && <PhotoPicker user={{ id: user.id, name: user.name, hasPhoto: user.hasPhoto }} />}
            <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
              <dt className="text-fg-subtle">Name</dt>
              <dd className="text-fg">{user.name}</dd>
              <dt className="text-fg-subtle">Email</dt>
              <dd className="text-fg">{user.email}</dd>
              <dt className="text-fg-subtle">Account</dt>
              <dd className="text-fg">{user.role === 'owner' ? 'Owner' : ACCOUNT_LABEL[accountType]}</dd>
              {!staff && <StudentDetails />}
              {rows
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-fg-subtle">{label}</dt>
                    <dd className="text-fg">{value}</dd>
                  </div>
                ))}
              <dt className="text-fg-subtle">Last sign-in</dt>
              <dd className="text-fg">{dateTime(user.lastLoginAt)}</dd>
              {staff && (
                <>
                  <dt className="text-fg-subtle">Access</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {permissions.length === 0 ? <span className="text-fg-muted">None yet</span> : permissions.map((p) => <Badge key={p} tone="neutral">{p}</Badge>)}
                  </dd>
                </>
              )}
            </dl>
            {profile?.bio && <p className="text-sm whitespace-pre-line text-fg-muted">{profile.bio}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Changing it signs you out on every other device.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
