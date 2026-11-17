import { useEffect, useRef, useState } from 'react';

const ROW = 56;

interface Props {
  values: number[];
  /** Where the wheel starts. Nothing is chosen until the shopper moves it or taps a row. */
  start: number;
  value: number | null;
  onChange: (value: number) => void;
  label: string;
  /** How each row reads, e.g. ₱6,000. Plain number if left out. */
  format?: (value: number) => string;
}

/**
 * A scrolling wheel, like the phone's own date picker (birth year, monthly budget). The centre row is the pick.
 * It starts with no pick, so a shopper who taps Next straight away saves nothing instead of the starting row
 * (otherwise answers pile up on one default and skew the reports).
 */
export function Wheel({ values, start, value, onChange, label, format = String }: Props) {
  const years = values;
  const box = useRef<HTMLDivElement>(null);
  const [centre, setCentre] = useState(() => Math.max(0, years.indexOf(start)));
  const settle = useRef<number | undefined>(undefined);
  const touched = useRef(false);

  useEffect(() => {
    const i = value != null ? years.indexOf(value) : years.indexOf(start);
    if (box.current && i >= 0) box.current.scrollTop = i * ROW;
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const i = Math.min(years.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
    setCentre(i);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      if (touched.current) onChange(years[i]);
    }, 120);
  }

  function pick(i: number) {
    touched.current = true;
    box.current?.scrollTo({ top: i * ROW, behavior: 'smooth' });
    setCentre(i);
    onChange(years[i]);
  }

  function key(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    pick(Math.min(years.length - 1, Math.max(0, centre + step)));
  }

  return (
    <div className="year-wheel">
      <div className="year-wheel-mark" aria-hidden="true" />
      <div
        ref={box}
        className="year-wheel-list"
        role="listbox"
        aria-label={label}
        aria-activedescendant={value != null ? `wheel-${value}` : undefined}
        tabIndex={0}
        onScroll={onScroll}
        onPointerDown={() => (touched.current = true)}
        onWheel={() => (touched.current = true)}
        onKeyDown={key}
      >
        <div style={{ height: ROW * 2 }} aria-hidden="true" />
        {years.map((y, i) => (
          <div
            key={y}
            id={`wheel-${y}`}
            role="option"
            aria-selected={value === y}
            className={`year-wheel-row ${i === centre ? 'centre' : ''} ${value === y ? 'picked' : ''}`}
            onClick={() => pick(i)}
          >
            {format(y)}
          </div>
        ))}
        <div style={{ height: ROW * 2 }} aria-hidden="true" />
      </div>
    </div>
  );
}
