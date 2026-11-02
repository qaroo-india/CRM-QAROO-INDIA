/**
 * React Hook Form + the shared Zod schemas. A form validates with exactly the
 * schema its endpoint validates with, and server field errors (422) land on
 * the matching inputs.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type FieldValues, type Path, type Resolver, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiRequestError } from './api';

export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'>,
): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  return useForm<z.input<S>, unknown, z.output<S>>({
    // zodResolver cannot carry a generic schema's input/output types through
    // this wrapper; the cast restates exactly what the schema guarantees.
    resolver: zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>,
    mode: 'onTouched',
    ...options,
  });
}

/**
 * Show a failed submission: field errors go onto their inputs, anything else
 * becomes a toast with the server's message.
 */
export function handleFormError<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, error: unknown, fallback = 'Could not save'): void {
  if (error instanceof ApiRequestError && error.fields?.length) {
    for (const field of error.fields) {
      form.setError(field.path as Path<T>, { type: 'server', message: field.message });
    }
    toast.error(error.message);
    return;
  }
  toast.error(error instanceof Error ? error.message : fallback);
}

/** Toast any mutation failure with the server's message. */
export function toastError(error: unknown, fallback = 'Something went wrong'): void {
  toast.error(error instanceof Error ? error.message : fallback);
}
