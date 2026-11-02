/**
 * A figure that counts up to its value ("₹4,82,300", "1,240", "86.5%", "₹4.8L"),
 * and glides from the old value to the new one when it changes. Only the first
 * number in the text moves; currency signs and units stay put. Screen readers
 * get the final value straight away.
 */

import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getFormatConfig } from '@/utils/format';

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;
const DURATION_MS = 900;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

function parse(text: string) {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const token = match[0];
  const decimals = token.split('.')[1]?.length ?? 0;
  const formatter = new Intl.NumberFormat(getFormatConfig().locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: token.includes(','),
  });
  return {
    value: Number(token.replace(/,/g, '')),
    render: (n: number) => text.slice(0, match.index) + formatter.format(n) + text.slice(match.index + token.length),
  };
}

function CountUp({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(() => (reduce ? text : (parse(text)?.render(0) ?? text)));
  const [done, setDone] = useState(Boolean(reduce));

  useEffect(() => {
    const target = parse(text);
    if (!target || reduce) {
      setShown(text);
      setDone(true);
      return;
    }
    setDone(false);
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      if (t >= 1) {
        setShown(text);
        setDone(true);
        from.current = target.value;
        return;
      }
      setShown(target.render(origin + (target.value - origin) * easeOutExpo(t)));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target.value;
    };
  }, [text, reduce]);

  if (done) return <>{text}</>;
  return (
    <>
      <span aria-hidden className="tabular-nums">{shown}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}

export function AnimatedValue({ value }: { value: ReactNode }) {
  // Tests and anything that is not plain text render as-is.
  if (import.meta.env.MODE === 'test' || (typeof value !== 'string' && typeof value !== 'number')) return <>{value}</>;
  return <CountUp text={String(value)} />;
}
