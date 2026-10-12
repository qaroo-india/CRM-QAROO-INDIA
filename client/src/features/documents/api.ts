import type { DocumentDto, Paginated } from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, fetchFile, saveBlob, toQuery, upload } from '@/lib/api';
import { toastError } from '@/lib/forms';

export function useDocuments(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['documents', 'list', query], queryFn: () => api.get<Paginated<DocumentDto>>(`/documents${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useStudentDocuments(studentId: string) {
  return useQuery({ queryKey: ['documents', 'student', studentId], queryFn: () => api.get<DocumentDto[]>(`/documents/student/${studentId}`) });
}

export function useUploadDocument(onDone?: (doc: DocumentDto) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => upload<DocumentDto>('/documents', form),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      if (doc.ownerType === 'expense') void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(`Uploaded "${doc.title}"${doc.accessLevel === 'restricted' ? ' (restricted)' : ''}`);
      onDone?.(doc);
    },
  });
}

export function useDeleteDocument(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/documents/${id}/delete`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Document removed. The file is retained for the audit trail.');
      onDone?.();
    },
    onError: (e) => toastError(e),
  });
}

export function useDownloadDocument() {
  return useMutation({
    mutationFn: (doc: Pick<DocumentDto, 'id' | 'fileName'>) => fetchFile(`/documents/${doc.id}/download`, { fallbackName: doc.fileName }),
    onSuccess: saveBlob,
    onError: (e) => toastError(e),
  });
}
