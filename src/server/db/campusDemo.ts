/**
 * DEMO DATA for the campus and portal areas: class schedule, attendance,
 * exams and attempts, study material, certificates, placement drives, leave,
 * tasks, inventory, and one student portal plus one faculty login to try.
 *
 * It builds on an existing demo database (the batches, students and staff that
 * `npm run db:demo` creates) and goes through the same services as the API, so
 * every business rule applies. Everything is marked [DEMO DATA] / "(demo)".
 * The caller runs the reminder sweep afterwards.
 * Used by demo.ts for a fresh database, and by demo-campus.ts to top up a demo
 * database loaded before these areas existed.
 */

import { randomBytes } from 'node:crypto';
import { addDays, type ExamPaper } from '@ims/shared';
import { and, asc, count, eq, inArray, like } from 'drizzle-orm';
import { grantFacultyLogin, grantStudentPortal } from '../modules/accounts/accounts.service';
import { saveAttendance, getRoster } from '../modules/attendance/attendance.service';
import { decideCertificate, requestCertificate } from '../modules/certificates/certificates.service';
import { addQuestion, createExam, saveAnswer, setExamStatus, startAttempt, submitAttempt } from '../modules/exams/exams.service';
import { createMaterial } from '../modules/materials/materials.service';
import { addApplicants, createDrive } from '../modules/placements/drives.service';
import { createSessions, setSessionStatus } from '../modules/schedule/schedule.service';
import { createTask, decideLeave, decideRequest, requestItem, requestLeave, saveItem, setTaskStatus } from '../modules/workplace/workplace.service';
import { instituteToday } from '../services/clock';
import type { RequestContext } from '../utils/context';
import { db } from './index';
import {
  admissions,
  batchAssignments,
  batches,
  certificates,
  classSessions,
  examOptions,
  exams,
  inventoryItems,
  leaveRequests,
  materials,
  placementDrives,
  placementProfiles,
  students,
  tasks,
  trainers,
  users,
} from './schema';

const MARK = '[DEMO DATA]';

/* Deterministic randomness, separate from demo.ts so either can change alone. */
let seed = 20261013;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = (p: number) => rand() < p;
function pick<T>(items: readonly T[], weights?: readonly number[]): T {
  if (!weights) return items[Math.floor(rand() * items.length)]!;
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

type Q = { text: string; options: string[]; correct: number };
/** Six questions per course; unit test 1 uses the first five, unit test 2 the last five. */
const QUESTIONS: Record<string, Q[]> = {
  FSD: [
    { text: 'Which HTML element is the right one for the main navigation links of a page?', options: ['<div>', '<nav>', '<section>', '<aside>'], correct: 1 },
    { text: 'What does `const` prevent in JavaScript?', options: ['Changing the object it points to', 'Re-assigning the variable', 'Reading the variable', 'Using it inside a function'], correct: 1 },
    { text: 'Which HTTP method is meant for creating a new resource?', options: ['GET', 'POST', 'HEAD', 'OPTIONS'], correct: 1 },
    { text: 'In React, what should you use to keep a value that changes and re-renders the component?', options: ['A global variable', 'useState', 'useRef', 'A CSS class'], correct: 1 },
    { text: 'Which SQL clause filters rows before grouping?', options: ['HAVING', 'ORDER BY', 'WHERE', 'LIMIT'], correct: 2 },
    { text: 'What does `git pull` do?', options: ['Uploads your commits', 'Fetches and merges remote changes', 'Deletes a branch', 'Creates a new repository'], correct: 1 },
  ],
  DAP: [
    { text: 'Which Python type is ordered and mutable?', options: ['tuple', 'list', 'frozenset', 'str'], correct: 1 },
    { text: 'In pandas, which method shows the first five rows?', options: ['df.top()', 'df.first()', 'df.head()', 'df.start()'], correct: 2 },
    { text: 'The median of 2, 4, 9, 11, 30 is', options: ['9', '11.2', '4', '11'], correct: 0 },
    { text: 'Which chart is best for showing a trend over time?', options: ['Pie chart', 'Line chart', 'Scatter plot', 'Treemap'], correct: 1 },
    { text: 'What does `df.groupby("city")["sales"].sum()` return?', options: ['Total sales per city', 'The number of cities', 'Average sales', 'Sorted rows'], correct: 0 },
    { text: 'A value far from the others in a dataset is called', options: ['A mode', 'An outlier', 'A quartile', 'A bias'], correct: 1 },
  ],
  CDO: [
    { text: 'What does a Dockerfile describe?', options: ['A running container', 'How to build an image', 'A network', 'A volume backup'], correct: 1 },
    { text: 'Which command lists running containers?', options: ['docker ps', 'docker images', 'docker run', 'docker pull'], correct: 0 },
    { text: 'In Kubernetes, the smallest deployable unit is a', options: ['Node', 'Pod', 'Service', 'Namespace'], correct: 1 },
    { text: 'CI usually means', options: ['Automatically building and testing every change', 'Writing code in the cloud', 'Copying servers', 'A code review rule'], correct: 0 },
    { text: 'Which file format do most CI pipelines use for configuration?', options: ['YAML', 'CSV', 'BMP', 'DOCX'], correct: 0 },
    { text: 'What does horizontal scaling mean?', options: ['A bigger server', 'More servers of the same kind', 'A faster disk', 'Fewer users'], correct: 1 },
  ],
  DMK: [
    { text: 'CTR stands for', options: ['Cost to reach', 'Click-through rate', 'Customer tracking ratio', 'Content type rule'], correct: 1 },
    { text: 'Which is an organic channel?', options: ['Search ads', 'SEO', 'Display ads', 'Sponsored posts'], correct: 1 },
    { text: 'A landing page should mainly', options: ['List every product', 'Drive one clear action', 'Show the company history', 'Load slowly'], correct: 1 },
    { text: 'What does a UTM parameter do?', options: ['Speeds up the site', 'Tags where a visit came from', 'Blocks bots', 'Compresses images'], correct: 1 },
    { text: 'If 1,000 people see an ad and 20 click, the CTR is', options: ['0.2%', '2%', '20%', '5%'], correct: 1 },
    { text: 'A/B testing compares', options: ['Two versions to see which performs better', 'Two competitors', 'Two budgets', 'Two countries'], correct: 0 },
  ],
};

const LINKS: Record<string, { title: string; url: string; kind: 'notes' | 'reference' | 'video' | 'slides' }[]> = {
  FSD: [
    { title: 'MDN: Learn web development', url: 'https://developer.mozilla.org/en-US/docs/Learn', kind: 'reference' },
    { title: 'React: Quick start', url: 'https://react.dev/learn', kind: 'notes' },
    { title: 'Git handbook', url: 'https://git-scm.com/book/en/v2', kind: 'reference' },
  ],
  DAP: [
    { title: 'The Python tutorial', url: 'https://docs.python.org/3/tutorial/', kind: 'notes' },
    { title: 'pandas: Getting started', url: 'https://pandas.pydata.org/docs/getting_started/index.html', kind: 'reference' },
    { title: 'Matplotlib tutorials', url: 'https://matplotlib.org/stable/tutorials/index.html', kind: 'reference' },
  ],
  CDO: [
    { title: 'Docker: Get started', url: 'https://docs.docker.com/get-started/', kind: 'notes' },
    { title: 'Kubernetes basics', url: 'https://kubernetes.io/docs/tutorials/kubernetes-basics/', kind: 'reference' },
    { title: 'GitHub Actions quickstart', url: 'https://docs.github.com/en/actions/quickstart', kind: 'reference' },
  ],
  DMK: [
    { title: 'Google Search Central: SEO starter guide', url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide', kind: 'notes' },
    { title: 'Google Analytics help', url: 'https://support.google.com/analytics', kind: 'reference' },
    { title: 'Campaign URL builder (UTM)', url: 'https://ga-dev-tools.google/campaign-url-builder/', kind: 'reference' },
  ],
};

export interface CampusDemoResult {
  counts: Record<string, number>;
  /** Development-only logins to try the portal and the faculty workspace. */
  logins: { student: string | null; faculty: string | null; password: string | null };
  failures: string[];
}

/** Has anything been recorded in the campus areas yet? */
export async function campusAreasEmpty(): Promise<boolean> {
  const tables = [classSessions, exams, materials, certificates, placementDrives, leaveRequests, tasks, inventoryItems] as const;
  for (const t of tables) {
    if (((await db.select({ n: count() }).from(t).get())?.n ?? 0) > 0) return false;
  }
  return true;
}

const offset = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;

export async function loadCampusDemo(owner: RequestContext): Promise<CampusDemoResult> {
  const today = instituteToday();
  const failures: string[] = [];
  const attempt = async <T>(label: string, fn: () => T | Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const counts = { classes: 0, registers: 0, exams: 0, attempts: 0, materials: 0, certificates: 0, drives: 0, driveApplicants: 0, leave: 0, tasks: 0, inventoryItems: 0, inventoryRequests: 0 };

  const running = await db.select().from(batches).where(and(eq(batches.status, 'running'), like(batches.notes, `%${MARK}%`))).orderBy(asc(batches.batchCode)).all();
  const completed = await db.select().from(batches).where(and(eq(batches.status, 'completed'), like(batches.notes, `%${MARK}%`))).orderBy(asc(batches.batchCode)).all();
  if (running.length === 0) throw new Error('No running demo batches found. Load the main demo first with "npm run db:demo".');
  const prefix = (code: string) => code.split('-')[0]!;
  const roster = async (batchId: string) =>
    await db
      .select({ admissionId: batchAssignments.admissionId, studentId: batchAssignments.studentId, email: students.email, name: students.fullName })
      .from(batchAssignments)
      .innerJoin(students, eq(students.id, batchAssignments.studentId))
      .where(and(eq(batchAssignments.batchId, batchId), eq(batchAssignments.status, 'active')))
      .orderBy(asc(students.studentCode))
      .all();
  // The batch and student whose portal login the demo hands out.
  const showcase = running[0]!;
  const showcaseStudent = (await roster(showcase.id)).find((p) => p.email);

  /* Portal and faculty logins first, so they receive the notifications below. */
  const password = `Demo-${randomBytes(6).toString('base64url')}-26`;
  let studentLogin: string | null = null;
  if (showcaseStudent && (await attempt('student login', async () => await grantStudentPortal(owner, showcaseStudent.studentId, { temporaryPassword: password })))) studentLogin = showcaseStudent.email;
  const trainer = showcase.trainerId ? await db.select().from(trainers).where(eq(trainers.id, showcase.trainerId)).get() : undefined;
  let facultyLogin: string | null = null;
  if (trainer?.email && (await attempt('faculty login', async () => await grantFacultyLogin(owner, trainer.id, { temporaryPassword: password })))) facultyLogin = trainer.email;

  /* Class schedule and attendance --------------------------------------- */
  // Classes follow each batch's own timetable text ("Mon–Fri 18:00–20:00",
  // "Sat–Sun 09:00–13:00"), so the portal never contradicts the batch card.
  const timetable = (schedule: string | null, i: number) => {
    const times = /(\d{2}):(\d{2})\D+(\d{2}):(\d{2})/.exec(schedule ?? '');
    const start = times ? `${times[1]}:${times[2]}` : ['10:00', '14:00', '18:00', '11:30'][i % 4]!;
    const minutes = times ? Number(times[3]) * 60 + Number(times[4]) - (Number(times[1]) * 60 + Number(times[2])) : 120;
    const weekdays = /^Sat/i.test(schedule ?? '') ? [6, 0] : [1, 3, 5];
    return { start, minutes: minutes > 0 ? minutes : 120, weekdays };
  };
  for (const [i, b] of running.entries()) {
    const firstDay = b.startDate > addDays(today, -27) ? b.startDate : addDays(today, -27);
    const slot = timetable(b.schedule, i);
    const made = await attempt('schedule', async () =>
      await createSessions(owner, {
        batchId: b.id,
        title: `${b.batchCode} class`,
        kind: 'lecture',
        startsAt: offset(firstDay, slot.start),
        durationMinutes: slot.minutes,
        location: `Lab ${(i % 3) + 1}`,
        description: `${MARK} Regular class.`,
        repeat: { weekdays: slot.weekdays, until: addDays(today, 21) },
      }),
    );
    if (!made) continue;
    counts.classes += made.length;
    const past = made.filter((s) => s.date < today);
    // One cancelled class, for the record.
    const cancelled = past.at(-4);
    if (cancelled) await attempt('cancel', async () => await setSessionStatus(owner, cancelled.id, { status: 'cancelled', cancelReason: `${MARK} Trainer unwell` }));
    for (const s of past) {
      if (s.id === cancelled?.id) continue;
      const rows = (await getRoster(owner, b.id, s.date)).rows;
      if (rows.length === 0) continue;
      const saved = await attempt('attendance', async () =>
        await saveAttendance(owner, {
          batchId: b.id,
          date: s.date,
          classSessionId: s.id,
          topic: `Session on ${s.date}`,
          records: rows.map((r) => {
            const status = pick(['present', 'late', 'absent', 'on_duty'] as const, [80, 7, 10, 3]);
            return { admissionId: r.admissionId, status, minutesLate: status === 'late' ? pick([5, 10, 15, 20]) : 0 };
          }),
        }),
      );
      if (saved) {
        counts.registers += 1;
        await attempt('class done', async () => await setSessionStatus(owner, s.id, { status: 'completed' }));
      }
    }
  }

  /* Exams: test 1 attempted by most of the batch, test 2 open -------------- */
  for (const b of running) {
    const bank = QUESTIONS[prefix(b.batchCode)];
    if (!bank) continue;
    const people = await roster(b.id);
    for (const [n, slice] of [[1, bank.slice(0, 5)], [2, bank.slice(1, 6)]] as const) {
      const exam = await attempt('exam', async () =>
        await createExam(owner, {
          title: `${b.batchCode} unit test ${n} (demo)`,
          kind: 'unit_test',
          batchId: b.id,
          instructions: `${MARK} Five questions. Choose one answer for each. Your answers save as you go.`,
          durationMinutes: 15,
          passPercent: 50,
          maxAttempts: n === 1 ? 2 : 1,
          availableUntil: offset(addDays(today, 14), '23:00'),
        }),
      );
      if (!exam) continue;
      for (const q of slice) await attempt('question', async () => await addQuestion(owner, exam.id, { text: q.text, marks: 1, options: q.options.map((text, k) => ({ text, isCorrect: k === q.correct })) }));
      if (!(await attempt('publish', async () => await setExamStatus(owner, exam.id, { status: 'published' })))) continue;
      counts.exams += 1;
      // Most of the batch (always the showcase student) has taken test 1; test 2 is left open to try.
      if (n !== 1) continue;
      for (const p of people) {
        if (p.studentId !== showcaseStudent?.studentId && !chance(0.8)) continue;
        const paper = await attempt('start', async () => await startAttempt(p.studentId, exam.id));
        if (!paper) continue;
        await answer(p.studentId, paper, chance(0.7) ? 0.85 : 0.45);
        if (await attempt('submit', async () => await submitAttempt(p.studentId, paper.attemptId))) counts.attempts += 1;
      }
    }
  }

  async function answer(studentId: string, paper: ExamPaper, skill: number) {
    const correct = new Map(
      (await db
        .select({ questionId: examOptions.questionId, id: examOptions.id })
        .from(examOptions)
        .where(and(inArray(examOptions.questionId, paper.questions.map((q) => q.id)), eq(examOptions.isCorrect, true)))
        .all())
        .map((o) => [o.questionId, o.id]),
    );
    for (const q of paper.questions) {
      if (!chance(0.95)) continue; // the odd unanswered question
      const right = correct.get(q.id);
      const wrong = q.options.filter((o) => o.id !== right);
      const optionId = chance(skill) || wrong.length === 0 ? right! : pick(wrong).id;
      await attempt('answer', async () => await saveAnswer(studentId, paper.attemptId, { questionId: q.id, optionId }));
    }
  }

  /* Study material (links, so the demo ships no files) ---------------------- */
  for (const b of running) {
    const links = LINKS[prefix(b.batchCode)];
    if (!links) continue;
    for (const [k, l] of links.entries()) {
      const made = await attempt('material', async () =>
        await createMaterial(owner, undefined, { title: `${l.title} (demo)`, description: `${MARK} Recommended reading.`, kind: l.kind, courseId: b.courseId, batchId: k === 0 ? b.id : undefined, externalUrl: l.url, isPublished: true }),
      );
      if (made) counts.materials += 1;
    }
  }

  /* Certificates for completed courses ------------------------------------- */
  const done = (await db.select({ id: admissions.id, studentId: admissions.studentId }).from(admissions).where(eq(admissions.status, 'completed')).orderBy(asc(admissions.admissionNumber)).all()).slice(0, 10);
  // A mix of every stage; "requested" ones come from the student, through the portal path.
  const CERT_FLOW = ['issued', 'requested', 'issued', 'approved', 'under_review', 'issued'] as const;
  for (const [i, a] of done.entries()) {
    const target = CERT_FLOW[i % CERT_FLOW.length]!;
    const byStudent = target === 'requested';
    const cert = await attempt('certificate', async () => await requestCertificate(owner, { admissionId: a.id, requestNote: byStudent ? `${MARK} Please print my name exactly as registered.` : MARK }, byStudent ? a.studentId : null));
    if (!cert) continue;
    counts.certificates += 1;
    if (target !== 'requested') await attempt('certificate decision', async () => await decideCertificate(owner, cert.id, { status: target }));
  }

  /* Placement drives -------------------------------------------------------- */
  const technical = completed.filter((b) => ['FSD', 'DAP', 'CDO'].includes(prefix(b.batchCode)));
  const nonTechnical = completed.filter((b) => prefix(b.batchCode) === 'DMK');
  const driveSpecs = [
    { companyName: 'CloudNest Systems', roleTitle: 'Junior Full Stack Developer', track: 'technical' as const, batchList: technical, packageMinor: 42_000_000, openings: 6, days: 12 },
    { companyName: 'Bluewave Analytics', roleTitle: 'Data Analyst Trainee', track: 'technical' as const, batchList: technical, packageMinor: 36_000_000, openings: 4, days: 20 },
    { companyName: 'Brightpath Digital', roleTitle: 'Digital Marketing Executive', track: 'non_technical' as const, batchList: nonTechnical, packageMinor: 28_000_000, openings: 3, days: 16 },
  ];
  for (const d of driveSpecs) {
    if (d.batchList.length === 0) continue;
    const drive = await attempt('drive', async () =>
      await createDrive(owner, {
        companyName: d.companyName,
        roleTitle: d.roleTitle,
        description: `${MARK} Campus hiring drive. Written test, then a technical and an HR round.`,
        track: d.track,
        status: 'open',
        driveDate: addDays(today, d.days),
        applyBy: addDays(today, d.days - 4),
        packageMinor: d.packageMinor,
        openings: d.openings,
        location: pick(['Chennai', 'Bengaluru', 'Hyderabad']),
        isRemote: false,
        eligibilityNote: 'Completed the course; resume ready.',
        batchIds: d.batchList.map((b) => b.id),
      }),
    );
    if (!drive) continue;
    counts.drives += 1;
    const profiles = (await db
      .select({ id: placementProfiles.id })
      .from(placementProfiles)
      .innerJoin(batchAssignments, eq(batchAssignments.admissionId, placementProfiles.admissionId))
      .where(and(inArray(batchAssignments.batchId, d.batchList.map((b) => b.id)), eq(placementProfiles.track, d.track)))
      .all())
      .map((p) => p.id)
      .filter(() => chance(0.6))
      .slice(0, 8);
    if (profiles.length) {
      const added = await attempt('applicants', async () => await addApplicants(owner, drive.id, { profileIds: profiles }));
      counts.driveApplicants += added?.added ?? 0;
    }
  }

  /* Staff: leave, tasks, inventory ------------------------------------------ */
  const team = await db.select().from(users).where(and(eq(users.role, 'staff'), eq(users.accountType, 'team'), like(users.email, '%@demo.invalid'), eq(users.isActive, true))).orderBy(asc(users.email)).all();
  const facultyUser = facultyLogin ? await db.select().from(users).where(eq(users.email, facultyLogin)).get() : undefined;
  const as = (u: typeof users.$inferSelect): RequestContext =>
    u.accountType === 'faculty'
      ? { actorId: u.id, actorName: u.name, permissions: [...u.permissions], isOwner: false, accountType: 'faculty', trainerId: trainer?.id ?? null }
      : { actorId: u.id, actorName: u.name, permissions: [...u.permissions], isOwner: false, accountType: 'team' };
  const people = [...team, ...(facultyUser ? [facultyUser] : [])];

  const leavePlan = [
    { who: 0, type: 'sick', from: -9, to: -8, decide: 'approve', reason: 'Fever' },
    { who: 1, type: 'casual', from: 5, to: 5, decide: null, reason: 'Family function' },
    { who: 2, type: 'earned', from: 18, to: 22, decide: null, reason: 'Trip home' },
    { who: 3, type: 'casual', from: 2, to: 2, decide: 'approve', reason: 'Personal work' },
    { who: 1, type: 'casual', from: -30, to: -29, decide: 'reject', reason: 'Month-end closing' },
  ] as const;
  for (const l of leavePlan) {
    const u = people[l.who];
    if (!u) continue;
    const made = await attempt('leave', async () => await requestLeave(as(u), { type: l.type, startDate: addDays(today, l.from), endDate: addDays(today, l.to), reason: `${MARK} ${l.reason}` }));
    if (!made) continue;
    counts.leave += 1;
    if (l.decide === 'approve') await attempt('leave decision', async () => await decideLeave(owner, made.id, { decision: 'approve' }));
    if (l.decide === 'reject') await attempt('leave decision', async () => await decideLeave(owner, made.id, { decision: 'reject', reviewNote: 'Month-end closing week; please pick other days.' }));
  }

  const taskPlan = [
    { to: team[0], title: 'Call back enquiries with missed follow-ups', due: -2, priority: 'high', status: 'todo' },
    { to: team[1], title: 'Prepare the weekend walk-in event list', due: 4, priority: 'medium', status: 'in_progress' },
    { to: team[2], title: 'Reconcile last month\'s UPI receipts', due: -1, priority: 'urgent', status: 'in_progress' },
    { to: team[2], title: 'Send fee reminders for overdue instalments', due: -6, priority: 'high', status: 'done' },
    { to: facultyUser, title: 'Upload slides for the next module', due: 3, priority: 'medium', status: 'todo', batch: showcase.id },
    { to: facultyUser, title: 'Review unit test 1 results with the batch', due: 6, priority: 'low', status: 'todo', batch: showcase.id },
  ] as const;
  for (const t of taskPlan) {
    if (!t.to) continue;
    const made = await attempt('task', async () => await createTask(owner, undefined, { title: `${t.title} (demo)`, details: MARK, assignedToId: t.to!.id, priority: t.priority, dueDate: addDays(today, t.due), batchId: 'batch' in t ? t.batch : undefined }));
    if (!made) continue;
    counts.tasks += 1;
    if (t.status !== 'todo') await attempt('task status', async () => await setTaskStatus(as(t.to!), made.id, { status: t.status }));
  }

  const itemPlan = [
    { assetTag: 'DEMO-LT-01', name: 'Laptop, i5 / 16 GB (demo)', category: 'laptop', quantityTotal: 12, unitValueMinor: 5_800_000, location: 'Lab 1' },
    { assetTag: 'DEMO-PJ-01', name: 'Projector, full HD (demo)', category: 'peripheral', quantityTotal: 3, unitValueMinor: 4_200_000, location: 'Store room' },
    { assetTag: 'DEMO-HS-01', name: 'USB headset (demo)', category: 'peripheral', quantityTotal: 20, unitValueMinor: 120_000, location: 'Store room' },
    { assetTag: 'DEMO-RT-01', name: 'Wi-Fi router (demo)', category: 'network', quantityTotal: 4, unitValueMinor: 650_000, location: 'Server rack' },
    { assetTag: 'DEMO-CH-01', name: 'Student chair (demo)', category: 'furniture', quantityTotal: 60, unitValueMinor: 250_000, location: 'Classrooms' },
    { assetTag: 'DEMO-MK-01', name: 'Whiteboard markers, box of 10 (demo)', category: 'consumable', quantityTotal: 40, unitValueMinor: 25_000, location: 'Front office', isConsumable: true },
  ] as const;
  const items = new Map<string, string>();
  for (const it of itemPlan) {
    const made = await attempt('item', async () => await saveItem(owner, { ...it, purchasedOn: addDays(today, -120), notes: MARK }));
    if (made) {
      items.set(it.assetTag, made.id);
      counts.inventoryItems += 1;
    }
  }
  const requestPlan = [
    { who: facultyUser, tag: 'DEMO-PJ-01', qty: 1, reason: 'Projector for the evening batch', action: 'issue' },
    { who: facultyUser, tag: 'DEMO-MK-01', qty: 2, reason: 'Markers for Lab 1', action: 'issue' },
    { who: team[0], tag: 'DEMO-LT-01', qty: 1, reason: 'Laptop for counselling demos', action: 'return' },
    { who: team[1], tag: 'DEMO-HS-01', qty: 2, reason: 'Headsets for calling', action: null },
    { who: team[2], tag: 'DEMO-LT-01', qty: 2, reason: 'Spare laptops for the accounts desk', action: 'reject' },
  ] as const;
  for (const r of requestPlan) {
    const itemId = items.get(r.tag);
    if (!r.who || !itemId) continue;
    const made = await attempt('inventory request', async () => await requestItem(as(r.who!), { itemId, quantity: r.qty, reason: `${MARK} ${r.reason}`, neededBy: addDays(today, 3) }));
    if (!made) continue;
    counts.inventoryRequests += 1;
    if (r.action === 'issue') await attempt('issue', async () => await decideRequest(owner, made.id, { action: 'issue' }));
    if (r.action === 'return') {
      await attempt('issue', async () => await decideRequest(owner, made.id, { action: 'issue' }));
      await attempt('return', async () => await decideRequest(owner, made.id, { action: 'return' }));
    }
    if (r.action === 'reject') await attempt('reject', async () => await decideRequest(owner, made.id, { action: 'reject', reviewNote: 'Two spares are already on the accounts desk.' }));
  }

  return { counts, logins: { student: studentLogin, faculty: facultyLogin, password: studentLogin || facultyLogin ? password : null }, failures };
}
