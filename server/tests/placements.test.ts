/**
 * The brief's placement tests: eligibility status, application tracking,
 * multiple applications, the unique-student placement rate, offer and joining
 * outcomes -- and that applying or interviewing is never "placed".
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let techCourse: string;
let hrCourse: string;
let plainCourse: string;
let n = 0;

async function completedAdmission(courseId: string, completedOn = '2026-09-15') {
  n += 1;
  const a = (
    await owner
      .post('/api/v1/admissions', { courseId, admissionDate: '2026-01-05', listFeeMinor: 1000, admissionFeeRequiredMinor: 0, newStudent: { fullName: `Grad ${n}`, phone: `94000${String(n).padStart(5, '0')}` } })
      .expect(201)
  ).body.data;
  await owner.post(`/api/v1/admissions/${a.id}/status`, { action: 'complete', date: completedOn }).expect(200);
  const profiles = (await owner.get(`/api/v1/placements/profiles?studentId=${a.studentId}`).expect(200)).body.data.items;
  return { admission: a, profile: profiles[0] as { id: string; stage: string; eligibleOn: string; track: string } | undefined };
}

async function apply(profileId: string, companyName: string, appliedOn = '2026-09-20') {
  return (await owner.post('/api/v1/placements/applications', { profileId, companyName, jobTitle: 'Analyst', appliedOn }).expect(201)).body.data;
}

function appIdFor(profile: { applicationsList: { id: string; companyName: string }[] }, company: string) {
  return profile.applicationsList.find((a) => a.companyName === company)!.id;
}

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  techCourse = (await owner.post('/api/v1/courses', { code: 'PY-01', name: 'Python Developer', standardFeeMinor: 1000, placementTrack: 'technical' }).expect(201)).body.data.id;
  hrCourse = (await owner.post('/api/v1/courses', { code: 'HRM-01', name: 'HR Management', standardFeeMinor: 1000, placementTrack: 'non_technical' }).expect(201)).body.data.id;
  plainCourse = (await owner.post('/api/v1/courses', { code: 'XL-01', name: 'Excel Basics', standardFeeMinor: 1000 }).expect(201)).body.data.id;
});

describe('eligibility', () => {
  it('opens an eligible profile when a placement course is completed', async () => {
    const { profile } = await completedAdmission(techCourse, '2026-09-10');
    expect(profile).toMatchObject({ stage: 'eligible', eligibleOn: '2026-09-10', track: 'technical' });
  });

  it('opens none for a course without placement support', async () => {
    const { profile } = await completedAdmission(plainCourse);
    expect(profile).toBeUndefined();
  });

  it('refuses a profile on the wrong track or a duplicate', async () => {
    const { admission } = await completedAdmission(hrCourse);
    const wrong = await owner.post('/api/v1/placements/profiles', { admissionId: admission.id, track: 'technical' }).expect(409);
    expect(wrong.body.error.code).toBe('PROFILE_EXISTS');
  });
});

describe('applications and outcomes', () => {
  it('tracks several applications and advances the stage with real events only', async () => {
    const { profile } = await completedAdmission(techCourse);
    await apply(profile!.id, 'Acme Analytics');
    const after = (await owner.get(`/api/v1/placements/profiles/${profile!.id}`).expect(200)).body.data;
    expect(after.stage).toBe('applied');
    expect(after.placed).toBe(false);

    await apply(profile!.id, 'Globex');
    const detail = (await owner.get(`/api/v1/placements/profiles/${profile!.id}`).expect(200)).body.data;
    expect(detail.applicationsList).toHaveLength(2);

    const interview = await owner
      .post(`/api/v1/placements/applications/${appIdFor(detail, 'Acme Analytics')}/interviews`, { roundNumber: 1, roundName: 'Technical', scheduledAt: '2026-09-25T10:30:00+05:30' })
      .expect(201);
    expect(interview.body.data.stage).toBe('interview_scheduled');
    expect(interview.body.data.placed).toBe(false);
  });

  it('requires dates for offers and joining, and permission to record them', async () => {
    const { profile } = await completedAdmission(techCourse);
    const detail = await apply(profile!.id, 'Initech');
    const appId = appIdFor(detail, 'Initech');

    const helper = await clientWith(app, { permissions: ['placements:read', 'placements:write'] });
    await helper.post(`/api/v1/placements/applications/${appId}/outcome`, { outcome: 'offer_received', offerOn: '2026-10-01' }).expect(403);

    const noDate = await owner.post(`/api/v1/placements/applications/${appId}/outcome`, { outcome: 'joined', offerOn: '2026-10-01' }).expect(422);
    expect(noDate.body.error.fields.map((f: { path: string }) => f.path)).toContain('joiningOn');

    const offered = await owner.post(`/api/v1/placements/applications/${appId}/outcome`, { outcome: 'offer_received', offerOn: '2026-10-01', offerPackageMinor: 45_000_000 }).expect(200);
    expect(offered.body.data).toMatchObject({ stage: 'offer_received', placed: false });

    const joined = await owner.post(`/api/v1/placements/applications/${appId}/outcome`, { outcome: 'joined', offerOn: '2026-10-01', joiningOn: '2026-10-15' }).expect(200);
    expect(joined.body.data).toMatchObject({ stage: 'joined', placed: true });
  });

  it('does not allow "joined" to be set by hand', async () => {
    const { profile } = await completedAdmission(techCourse);
    const res = await owner.post(`/api/v1/placements/profiles/${profile!.id}/stage`, { stage: 'joined' }).expect(422);
    expect(res.body.error.code).toBe('JOIN_NEEDS_APPLICATION');
  });
});

describe('placement rate', () => {
  it('counts unique students over the eligible cohort, excluding those not seeking', async () => {
    const from = '2026-03-01';
    const to = '2026-03-31';
    // Cohort: four HR graduates eligible in March 2026.
    const a = await completedAdmission(hrCourse, '2026-03-05'); // two offers, joins one
    const b = await completedAdmission(hrCourse, '2026-03-10'); // offer, declines
    const c = await completedAdmission(hrCourse, '2026-03-12'); // interview only
    const d = await completedAdmission(hrCourse, '2026-03-20'); // not seeking
    await completedAdmission(hrCourse, '2026-04-02'); // outside the cohort window

    const aDetail1 = await apply(a.profile!.id, 'Northwind', '2026-03-15');
    const aDetail2 = await apply(a.profile!.id, 'Contoso', '2026-03-16');
    await owner.post(`/api/v1/placements/applications/${appIdFor(aDetail1, 'Northwind')}/outcome`, { outcome: 'offer_received', offerOn: '2026-03-25' }).expect(200);
    await owner.post(`/api/v1/placements/applications/${appIdFor(aDetail2, 'Contoso')}/outcome`, { outcome: 'joined', offerOn: '2026-03-26', joiningOn: '2026-04-05' }).expect(200);

    const bDetail = await apply(b.profile!.id, 'Northwind', '2026-03-18');
    await owner.post(`/api/v1/placements/applications/${appIdFor(bDetail, 'Northwind')}/outcome`, { outcome: 'offer_declined', offerOn: '2026-03-28' }).expect(200);

    const cDetail = await apply(c.profile!.id, 'Fabrikam', '2026-03-20');
    const interview = await owner.post(`/api/v1/placements/applications/${appIdFor(cDetail, 'Fabrikam')}/interviews`, { roundNumber: 1, roundName: 'HR', scheduledAt: '2026-03-22T11:00:00+05:30' }).expect(201);
    const interviewId = interview.body.data.applicationsList[0].interviews[0].id;
    await owner.post(`/api/v1/placements/interviews/${interviewId}/result`, { result: 'failed' }).expect(200);

    await owner.post(`/api/v1/placements/profiles/${d.profile!.id}/stage`, { stage: 'not_seeking' }).expect(200);

    const analytics = (await owner.get(`/api/v1/placements/analytics?from=${from}&to=${to}&track=non_technical`).expect(200)).body.data;
    expect(analytics.funnel).toMatchObject({ eligible: 4, excluded: 1, applied: 3, interviewed: 1, offered: 2, joined: 1 });
    // One placed out of (4 - 1) seeking: two offers to the same student count once.
    expect(analytics.funnel.placementRate).toBeCloseTo(1 / 3, 10);
    expect(analytics.byTrack.find((t: { track: string }) => t.track === 'technical').eligible).toBe(0);
    expect(analytics.byCompany.find((c2: { companyName: string }) => c2.companyName === 'Northwind')).toMatchObject({ applications: 2, offers: 2, joined: 0 });
  });

  it('reports joins in the month they happened', async () => {
    const analytics = (await owner.get('/api/v1/placements/analytics?from=2026-03-01&to=2026-04-30&track=non_technical').expect(200)).body.data;
    expect(analytics.monthlyJoined).toEqual([
      { month: '2026-03', technical: 0, nonTechnical: 0 },
      { month: '2026-04', technical: 0, nonTechnical: 1 },
    ]);
    expect(analytics.activity.joined).toBe(1);
  });
});
