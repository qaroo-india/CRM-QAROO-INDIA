import type { ComponentProps } from 'react';
import { getFormatConfig } from '@/utils/format';
import { Input } from './Input';

/**
 * Text input for an amount in rupees (major units). It stays a string until
 * the shared moneyInputSchema converts it to exact paise, so "1,25,000.50"
 * is accepted and nothing is rounded through floating point on the way.
 */
export function MoneyInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const symbol =
    new Intl.NumberFormat(getFormatConfig().locale, { style: 'currency', currency: getFormatConfig().currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? '';
  return <Input type="text" inputMode="decimal" autoComplete="off" leading={symbol} placeholder="0.00" {...props} />;
}
