import { useEffect, useRef, useState } from 'react';

const ROW = 56;

interface Props {
  years: number[];
  /** Where the wheel starts. Nothing is chosen until the shopper moves it or taps a year. */
  start: number;
  value: number | null;
  onChange: (year: number) => void;
  label: string;
}

/**
 * A scrolling wheel of years, like the phone's own date picker. The centre row is the pick. It starts with no
 * pick, so a shopper who taps Next straight away saves nothing instead of the starting year (otherwise birth
 * years pile up on one default and skew the reports).
 */
export function YearWheel({ years, start, value, onChange, label }: Props) {
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
        aria-activedescendant={value != null ? `year-${value}` : undefined}
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
            id={`year-${y}`}
            role="option"
            aria-selected={value === y}
            className={`year-wheel-row ${i === centre ? 'centre' : ''} ${value === y ? 'picked' : ''}`}
            onClick={() => pick(i)}
          >
            {y}
          </div>
        ))}
        <div style={{ height: ROW * 2 }} aria-hidden="true" />
      </div>
    </div>
  );
}
