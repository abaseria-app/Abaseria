// Line icons for the Explore screen and the bottom bar, drawn on a 24 × 24 grid in the text color.

const PATHS = {
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13z M15.5 15.5 21 21',
  cart: 'M3 4h2l2.5 11h11L21 7H6.4 M9 20h.01 M18 20h.01',
  scan: 'M3 7V4h3 M18 4h3v3 M21 17v3h-3 M6 20H3v-3 M7 8v8 M10 8v8 M13 8v8 M17 8v8',
  community: 'M9 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M3 20a6 6 0 0 1 12 0 M16 5a3 3 0 0 1 0 6 M21 20a6 6 0 0 0-3.5-5.4',
  profile: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  chat: 'M4 5h16v11H9l-5 4z M8 10h.01 M12 10h.01 M16 10h.01',
  close: 'M6 6l12 12 M18 6L6 18',
  products: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  recipes: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11',
  budget: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 7l12-4v4 M16 13h2',
  pantry: 'M4 3h16v18H4z M4 12h16 M10 7h4 M10 16h4',
  articles: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  meat: 'M3 12c3-5 9-6 14-2l4-3v10l-4-3c-5 4-11 3-14-2z M8 11.5h.01',
  poultry: 'M12 3c4 0 7 7 7 11a7 7 0 0 1-14 0c0-4 3-11 7-11z',
  vegetables: 'M5 19C5 10 10 5 19 5c0 9-5 14-14 14z M5 19l8-8',
  dairy: 'M8 3h8v3l2 3v12H6V9l2-3z M6 9h12',
  pantryCan: 'M6 5a6 2 0 0 0 12 0a6 2 0 0 0-12 0 M6 5v14a6 2 0 0 0 12 0V5 M6 10h12',
  dry: 'M3 11h18a9 9 0 0 1-18 0z M8 8c0-2 1-3 2-4 M13 8c0-2 1-3 2-4',
  household: 'M9 9h6v12H9z M10 9V5h5l2 2 M15 5h3',
  other: 'M5 12h.01 M12 12h.01 M19 12h.01',
  condiments: 'M11 2h2v4 M9 6h6l1 4v11H8V10z M8 14h8',
  bread: 'M4 9a4 4 0 0 1 4-5h8a4 4 0 0 1 4 5h-1v11H5V9z',
  candy: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M9 12L4 8v8z M15 12l5-4v8z',
  drink: 'M6 8h12l-1.5 13h-9z M12 8l2-5h3',
  frozen: 'M12 2v20 M3.3 7l17.4 10 M3.3 17L20.7 7 M9 4l3 2 3-2 M9 20l3-2 3 2',
  personalCare: 'M8 10h8v11H8z M12 10V6 M10 6h6 M16 6v2',
  baby: 'M12 21a8 8 0 1 0 0-16a8 8 0 0 0 0 16z M12 5c0-2 2-3 3-2 M9.5 12h.01 M14.5 12h.01 M10 16a2.5 1.5 0 0 0 4 0',
  health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  pet: 'M12 13c-3 0-6 3-6 6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2c0-3-3-6-6-6z M5 10a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M8.5 6.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M12.5 6.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M16 10a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  cupcake: 'M5 11h14l-2 10H7z M5 11a7 5 0 0 1 14 0 M12 4v2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 26, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function SoonBadge() {
  return <span className="soon-badge" aria-hidden="true">SOON</span>;
}
