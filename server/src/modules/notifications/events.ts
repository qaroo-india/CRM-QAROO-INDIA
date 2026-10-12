/**
 * Notifications raised by other modules' lifecycle hooks. Imported for its
 * side effect by notifications.routes, so it registers once at startup.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { admissions, courses, students } from '../../db/schema';
import { admissionHooks } from '../admissions/hooks';
import { notifyUsers, ownerIds, safely } from './notifications.service';

admissionHooks.registerAfterCommit((event, admissionId) => {
  if (event !== 'created') return;
  safely('new_admission', () => {
    const row = db
      .select({ number: admissions.admissionNumber, createdById: admissions.createdById, student: students.fullName, course: courses.name })
      .from(admissions)
      .innerJoin(students, eq(students.id, admissions.studentId))
      .innerJoin(courses, eq(courses.id, admissions.courseId))
      .where(eq(admissions.id, admissionId))
      .get();
    if (!row) return;
    notifyUsers(
      ownerIds().filter((id) => id !== row.createdById),
      {
        type: 'new_admission',
        severity: 'success',
        title: `New admission: ${row.student}`,
        body: `${row.course} · ${row.number}`,
        link: `/admissions?admission=${admissionId}`,
        entityType: 'admission',
        entityId: admissionId,
        dedupeKey: `admission:${admissionId}`,
      },
    );
  });
});
