import type { AdmissionFinanceView, InstalmentRow, LoanDetail, LoanDto, LoanSummary, Paginated, PaymentDto, PaymentList, ReceiptDto } from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, toQuery } from '@/lib/api';
import { toastError } from '@/lib/forms';

export function useAdmissionFinance(admissionId: string | null | undefined) {
  return useQuery({
    queryKey: ['finance', admissionId],
    queryFn: () => api.get<AdmissionFinanceView>(`/admissions/${admissionId}/finance`),
    enabled: !!admissionId,
  });
}

export function usePayments(query: Record<string, unknown>) {
  return useQuery({
    queryKey: ['payments', 'list', query],
    queryFn: () => api.get<PaymentList>(`/payments${toQuery(query)}`),
    placeholderData: keepPreviousData,
  });
}

export function useReceipt(paymentId: string | null) {
  return useQuery({
    queryKey: ['payments', 'receipt', paymentId],
    queryFn: () => api.get<ReceiptDto>(`/payments/${paymentId}/receipt`),
    enabled: !!paymentId,
  });
}

export function useInstalments(query: Record<string, unknown>) {
  return useQuery({
    queryKey: ['instalments', query],
    queryFn: () => api.get<Paginated<InstalmentRow> & { summary: { scheduledMinor: number; remainingMinor: number } }>(`/instalments${toQuery(query)}`),
    placeholderData: keepPreviousData,
  });
}

export function useLoans(query: Record<string, unknown>) {
  return useQuery({
    queryKey: ['loans', 'list', query],
    queryFn: () => api.get<Paginated<LoanDto>>(`/loans${toQuery(query)}`),
    placeholderData: keepPreviousData,
  });
}

export function useLoanSummary() {
  return useQuery({ queryKey: ['loans', 'summary'], queryFn: () => api.get<LoanSummary>('/loans/summary') });
}

export function useLoan(id: string | null) {
  return useQuery({ queryKey: ['loans', 'detail', id], queryFn: () => api.get<LoanDetail>(`/loans/${id}`), enabled: !!id });
}

/** Everything that shows money must refresh after a ledger change. */
export function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['finance', 'payments', 'instalments', 'admissions', 'students', 'loans', 'dashboard', 'reports']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useReversePayment() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<PaymentDto>(`/payments/${id}/reverse`, { reason }),
    onSuccess: (payment) => {
      invalidate();
      toast.success(`${payment.receiptNumber} reversed`);
    },
    onError: (error) => toastError(error),
  });
}

export function useLoanMutation<V>(fn: (vars: V) => Promise<LoanDetail>, success: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: fn,
    onSuccess: (loan) => {
      queryClient.setQueryData(['loans', 'detail', loan.id], loan);
      invalidate();
      toast.success(success);
    },
    onError: (error) => toastError(error),
  });
}
