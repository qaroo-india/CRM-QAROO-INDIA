import { FileStack, Upload } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { useStudentDocuments } from './api';
import { DocumentTable } from './DocumentTable';
import { UploadDialog } from './UploadDialog';

/** A student's own documents plus those on their admissions, loans and applications. */
export function StudentDocumentsTab({ studentId, studentName }: { studentId: string; studentName?: string }) {
  const { can } = useAuth();
  const docs = useStudentDocuments(studentId);
  const [open, setOpen] = useState(false);
  if (!can('documents:read')) return <EmptyState compact icon={FileStack} title="You do not have access to documents" />;
  return (
    <div className="space-y-3">
      {can('documents:write') && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}><Upload aria-hidden className="size-4" /> Upload</Button>
        </div>
      )}
      <DocumentTable rows={docs.data} loading={docs.isPending} error={docs.error} empty={<EmptyState compact icon={FileStack} title="No documents for this student" description="ID proofs, admission forms and certificates appear here." />} />
      <UploadDialog open={open} onOpenChange={setOpen} owner={{ ownerType: 'student', ownerId: studentId, label: studentName ?? 'this student' }} />
    </div>
  );
}
