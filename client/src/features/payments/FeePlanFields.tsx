/**
 * Payment-plan editor with a live schedule preview. The preview uses the same
 * remainder-safe allocator as the server, so what you see is exactly what
 * gets created (the server still validates and builds it independently).
 */

import { addMonths, buildInstalmentAmounts, toMinor, type CourseDto, type FeePlanInput } from '@ims/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { cn } from '@/lib/cn';
import { date, money } from '@/utils/format';

export type PlanChoice = 'none' | FeePlanInput['planType'];

export interface FeePlanState {
  planType: PlanChoice;
  startDate: string;
  instalmentCount: string;
  firstDueDate: string;
  expectedDisbursementDate: string;
  schedule: { dueDate: string; amount: string }[];
}

const PLAN_OPTIONS: { value: PlanChoice; label: string; description: string }[] = [
  { value: 'none', label: 'Decide later', description: 'Register now; set up the plan from the admission.' },
  { value: 'full_payment', label: 'Full payment', description: 'The whole fee in one payment.' },
  { value: 'admission_plus_monthly', label: 'Admission fee + monthly', description: 'Equal monthly instalments after the admission fee.' },
  { value: 'admission_plus_flexible', label: 'Admission fee + flexible', description: 'Your own dates and amounts.' },
  { value: 'internal_financing', label: 'Institute financing', description: 'Monthly instalments on the institute’s own credit.' },
  { value: 'external_financing', label: 'External loan', description: 'Balance expected from a lender on a date.' },
];

function parse(value: string): number | null {
  try {
    return value.trim() ? toMinor(value) : null;
  } catch {
    return null;
  }
}

export function useFeePlanState(initial?: Partial<FeePlanState>) {
  const [state, setState] = useState<FeePlanState>({
    planType: 'none',
    startDate: '',
    instalmentCount: '3',
    firstDueDate: '',
    expectedDisbursementDate: '',
    schedule: [{ dueDate: '', amount: '' }],
    ...initial,
  });

  const applyCourseDefaults = useCallback((course: CourseDto) => {
    if (course.defaultInstalmentCount) {
      setState((s) => ({ ...s, instalmentCount: String(course.defaultInstalmentCount), planType: s.planType === 'none' ? 'admission_plus_monthly' : s.planType }));
    }
  }, []);

  /** A human-readable problem, or null when the plan can be submitted. */
  const validate = useCallback(
    (agreedMinor: number, admissionFeeMinor: number): string | null => {
      const t = state.planType;
      if (t === 'none' || t === 'full_payment') return null;
      if (t === 'admission_plus_monthly' || t === 'internal_financing') {
        const n = Number(state.instalmentCount);
        if (!Number.isInteger(n) || n < 1 || n > 60) return 'Choose between 1 and 60 monthly instalments.';
        if (!state.firstDueDate) return 'Choose when the first instalment is due.';
      }
      if (t === 'external_financing' && !state.expectedDisbursementDate) return 'Choose when the lender is expected to pay.';
      if (t === 'admission_plus_flexible') {
        const total = state.schedule.reduce((sum, row) => sum + (parse(row.amount) ?? NaN), 0);
        if (state.schedule.some((row) => !row.dueDate || parse(row.amount) === null)) return 'Every flexible instalment needs a date and an amount.';
        const balance = agreedMinor - admissionFeeMinor;
        if (total !== balance) return `The flexible instalments add up to ${money(total)}, but ${money(balance)} remains after the admission fee.`;
      }
      return null;
    },
    [state],
  );

  return { state, setState, applyCourseDefaults, validate };
}

/** The API body for the chosen plan, or undefined for "decide later". */
export function feePlanPayload(state: FeePlanState, fallbackStart: string): FeePlanInput | undefined {
  if (state.planType === 'none') return undefined;
  const startDate = state.startDate || fallbackStart;
  switch (state.planType) {
    case 'full_payment':
      return { planType: 'full_payment', startDate };
    case 'admission_plus_monthly':
    case 'internal_financing':
      return { planType: state.planType, startDate, instalmentCount: Number(state.instalmentCount), firstDueDate: state.firstDueDate };
    case 'admission_plus_flexible':
      return { planType: 'admission_plus_flexible', startDate, schedule: state.schedule.map((row) => ({ dueDate: row.dueDate, amountMinor: parse(row.amount) ?? 0 })) };
    case 'external_financing':
      return { planType: 'external_financing', startDate, expectedDisbursementDate: state.expectedDisbursementDate };
  }
}

function previewRows(state: FeePlanState, agreedMinor: number, admissionFeeMinor: number, start: string) {
  const fee = Math.min(admissionFeeMinor, agreedMinor);
  const rows: { label: string; dueDate: string; amountMinor: number }[] = [];
  if (agreedMinor <= 0) return rows;
  if (state.planType === 'full_payment') return [{ label: 'Full payment', dueDate: start, amountMinor: agreedMinor }];
  if (fee > 0) rows.push({ label: 'Admission fee', dueDate: start, amountMinor: fee });
  if ((state.planType === 'admission_plus_monthly' || state.planType === 'internal_financing') && state.firstDueDate) {
    const n = Number(state.instalmentCount);
    if (Number.isInteger(n) && n >= 1 && n <= 60) {
      buildInstalmentAmounts(agreedMinor, fee, n).forEach((amount, i) => {
        if (amount > 0) rows.push({ label: `Instalment ${i + 1}`, dueDate: addMonths(state.firstDueDate, i), amountMinor: amount });
      });
    }
  }
  if (state.planType === 'external_financing' && agreedMinor - fee > 0) {
    rows.push({ label: 'Lender disbursement', dueDate: state.expectedDisbursementDate, amountMinor: agreedMinor - fee });
  }
  if (state.planType === 'admission_plus_flexible') {
    state.schedule.forEach((row, i) => {
      const amount = parse(row.amount);
      if (amount) rows.push({ label: `Instalment ${i + 1}`, dueDate: row.dueDate, amountMinor: amount });
    });
  }
  return rows;
}

interface FeePlanFieldsProps {
  plan: ReturnType<typeof useFeePlanState>;
  agreedMinor: number;
  admissionFeeMinor: number;
  /** Hide "decide later" when a plan is required (create/restructure dialogs). */
  required?: boolean;
  defaultStart?: string;
}

export function FeePlanFields({ plan, agreedMinor, admissionFeeMinor, required, defaultStart = '' }: FeePlanFieldsProps) {
  const { state, setState } = plan;
  const set = (patch: Partial<FeePlanState>) => setState((s) => ({ ...s, ...patch }));
  const start = state.startDate || defaultStart;
  const rows = useMemo(() => previewRows(state, agreedMinor, admissionFeeMinor, start), [state, agreedMinor, admissionFeeMinor, start]);
  const options = required ? PLAN_OPTIONS.filter((o) => o.value !== 'none') : PLAN_OPTIONS;
  const problem = plan.validate(agreedMinor, admissionFeeMinor);

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Plan type" className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={state.planType === option.value}
            onClick={() => set({ planType: option.value })}
            className={cn(
              'rounded-control border p-3 text-left transition-colors',
              state.planType === option.value ? 'border-primary/50 bg-primary-soft' : 'hover:border-border-strong',
            )}
          >
            <span className={cn('block text-sm font-medium', state.planType === option.value ? 'text-primary' : 'text-fg')}>{option.label}</span>
            <span className="block text-xs text-fg-muted">{option.description}</span>
          </button>
        ))}
      </div>

      {state.planType !== 'none' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={state.planType === 'full_payment' ? 'Due on' : 'Admission fee due'} hint="Defaults to the admission date.">
            <Input type="date" value={state.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </Field>
          {(state.planType === 'admission_plus_monthly' || state.planType === 'internal_financing') && (
            <>
              <Field label="Monthly instalments">
                <Select value={state.instalmentCount} onChange={(e) => set({ instalmentCount: e.target.value })} options={Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` }))} />
              </Field>
              <Field label="First instalment due">
                <Input type="date" value={state.firstDueDate} onChange={(e) => set({ firstDueDate: e.target.value })} />
              </Field>
            </>
          )}
          {state.planType === 'external_financing' && (
            <Field label="Expected disbursement">
              <Input type="date" value={state.expectedDisbursementDate} onChange={(e) => set({ expectedDisbursementDate: e.target.value })} />
            </Field>
          )}
        </div>
      )}

      {state.planType === 'admission_plus_flexible' && (
        <div className="space-y-2">
          {state.schedule.map((row, index) => (
            <div key={index} className="flex items-end gap-2">
              <Field label={`Instalment ${index + 1} due`} className="flex-1">
                <Input type="date" value={row.dueDate} onChange={(e) => set({ schedule: state.schedule.map((r, i) => (i === index ? { ...r, dueDate: e.target.value } : r)) })} />
              </Field>
              <Field label="Amount" className="flex-1">
                <MoneyInput value={row.amount} onChange={(e) => set({ schedule: state.schedule.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)) })} />
              </Field>
              <Button variant="ghost" size="icon" aria-label={`Remove instalment ${index + 1}`} disabled={state.schedule.length === 1} onClick={() => set({ schedule: state.schedule.filter((_, i) => i !== index) })}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => set({ schedule: [...state.schedule, { dueDate: '', amount: '' }] })}>
            <Plus aria-hidden className="size-4" /> Add instalment
          </Button>
        </div>
      )}

      {state.planType !== 'none' && rows.length > 0 && (
        <div className="overflow-x-auto rounded-control border">
          <table className="w-full text-sm">
            <caption className="sr-only">Schedule preview</caption>
            <thead>
              <tr className="border-b bg-surface-raised text-left text-xs text-fg-subtle uppercase">
                <th scope="col" className="px-3 py-2 font-medium">Instalment</th>
                <th scope="col" className="px-3 py-2 font-medium">Due</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="px-3 py-2 text-fg">{row.label}</td>
                  <td className="px-3 py-2 text-fg-muted tabular-nums">{row.dueDate ? date(row.dueDate) : '—'}</td>
                  <td className="px-3 py-2 text-right text-fg tabular-nums">{money(row.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-raised">
                <td colSpan={2} className="px-3 py-2 font-medium text-fg">Total</td>
                <td className="px-3 py-2 text-right font-semibold text-fg tabular-nums">{money(rows.reduce((s, r) => s + r.amountMinor, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {problem && state.planType !== 'none' && <p className="text-xs font-medium text-warning">{problem}</p>}
    </div>
  );
}
