import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_IDS, OTHER, categoryOf, guessCategory, sharedCategory } from './categories';

describe('guessCategory', () => {
  const cases: Array<[string, string]> = [
    ['Pork Liempo', 'meat, poultry & seafood'],
    ['Chicken Breast Fillet', 'meat, poultry & seafood'],
    ['Purefoods Chicken Hotdog 1kg', 'meat, poultry & seafood'],
    ['Bangus (Milkfish)', 'meat, poultry & seafood'],
    ['CDO Chicken Vienna Sausage', 'canned & preserved food'],
    ['Century Tuna Flakes in Oil', 'canned & preserved food'],
    ['Purefoods Corned Beef 210g', 'canned & preserved food'],
    ['Del Monte Fruit Cocktail 432g', 'canned & preserved food'],
    ['Kamatis', 'fruits & vegetables'],
    ['Calamansi 250g', 'fruits & vegetables'],
    ['Saging Lakatan', 'fruits & vegetables'],
    ['Lucky Me Pancit Canton Chicken 60g', 'pantry staples'],
    ['Lucky Me Egg Noodles', 'pantry staples'],
    ['Jasmine Rice 5kg', 'pantry staples'],
    ['White Sugar 1kg', 'pantry staples'],
    ['Del Monte Tomato Sauce 250g', 'cooking essentials & condiments'],
    ['Datu Puti Soy Sauce', 'cooking essentials & condiments'],
    ['Coconut Milk 400ml', 'cooking essentials & condiments'],
    ['Nescafe Classic 50g', 'beverages'],
    ['Bear Brand Powdered Milk 300g', 'beverages'],
    ['Coke 1.5L', 'beverages'],
    ['Eden Cheese 165g', 'dairy & eggs'],
    ['Alaska Evaporated Milk 370ml', 'dairy & eggs'],
    ['Eggs Medium 12pcs', 'dairy & eggs'],
    ['Itlog na Maalat 6pcs', 'dairy & eggs'],
    ['Quail Eggs 18pcs', 'dairy & eggs'],
    ['Gardenia Classic White Bread', 'bread & bakery'],
    ['Skyflakes Crackers 250g', 'snacks, candies & sweets'],
    ['Selecta Ice Cream Cookies & Cream 1.5L', 'frozen & ready-to-eat food'],
    ['Maya All Purpose Flour 1kg', 'baking and desserts'],
    ['Joy Dishwashing Liquid Lemon 250ml', 'household & cleaning supplies'],
    ['Downy Fabcon Sunrise Fresh', 'household & cleaning supplies'],
    ['Safeguard Pure White Soap', 'personal care & hygiene'],
    ['Colgate Toothpaste 150g', 'personal care & hygiene'],
    ['Pampers Baby Dry L', 'baby & kids'],
    ["Johnson's Baby Shampoo 200ml", 'baby & kids'],
    ['Green Cross Isopropyl Alcohol 500ml', 'health & wellness'],
    ['Pedigree Beef Dog Food 1.5kg', 'pet supplies'],
    ['Item •03', 'other'],
    ['', 'other'],
  ];
  for (const [name, cat] of cases) {
    it(`"${name}" -> ${cat}`, () => expect(guessCategory(name)).toBe(cat));
  }

  it('matches whole words only', () => {
    expect(guessCategory('Cornflakes')).toBe('other'); // not "corn"
    expect(guessCategory('Hamburger patties')).toBe('other'); // not "ham"
  });

  it('only ever answers with one of the 16 or other', () => {
    for (const [name] of cases) expect([...CATEGORY_IDS, 'other']).toContain(guessCategory(name));
  });
});

describe('categoryOf', () => {
  it('prefers what the shopper picked over the guess', () => {
    expect(categoryOf({ label: 'Pork Liempo', category: 'pet supplies' })).toBe('pet supplies');
    expect(categoryOf({ label: 'Pork Liempo', category: null })).toBe('meat, poultry & seafood');
    expect(categoryOf({ label: 'Pork Liempo' })).toBe('meat, poultry & seafood');
  });

  it('maps the 8 old ids, re-reading the name where one old bucket split', () => {
    expect(categoryOf({ label: 'Safeguard Soap', category: 'household' })).toBe('personal care & hygiene');
    expect(categoryOf({ label: 'Mystery', category: 'household' })).toBe('household & cleaning supplies');
    expect(categoryOf({ label: 'Eggs 12pcs', category: 'poultry' })).toBe('dairy & eggs');
    expect(categoryOf({ label: 'Mystery', category: 'poultry' })).toBe('meat, poultry & seafood');
    expect(categoryOf({ label: 'Coke 1.5L', category: 'pantry' })).toBe('beverages');
    expect(categoryOf({ label: 'Mystery', category: 'pantry' })).toBe('pantry staples');
    expect(categoryOf({ label: 'Mystery', category: 'dry' })).toBe('pantry staples');
    expect(categoryOf({ label: 'Mystery', category: 'dairy' })).toBe('dairy & eggs');
    expect(categoryOf({ label: 'Mystery', category: 'vegetables' })).toBe('fruits & vegetables');
    expect(categoryOf({ label: 'Mystery', category: 'meat' })).toBe('meat, poultry & seafood');
  });
});

describe('the 16 categories', () => {
  it('match the database list exactly, in order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([...CATEGORY_IDS]);
    expect(CATEGORY_IDS).toHaveLength(16);
  });

  it('each has its own color', () => {
    const colors = [...CATEGORIES, OTHER].map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('upload as themselves; an unsorted item uploads as no category', () => {
    expect(sharedCategory('beverages')).toBe('beverages');
    expect(sharedCategory('other')).toBeNull();
  });
});

// WCAG 2 contrast ratio between two #rrggbb colors.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('category chip labels', () => {
  it.each([...CATEGORIES, OTHER].map((c) => [c.label, c.color, c.ink]))('%s label is readable on its chip', (_label, color, ink) => {
    expect(contrast(color, ink)).toBeGreaterThanOrEqual(4.5);
  });
});
