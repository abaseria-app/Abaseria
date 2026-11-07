import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryOf, guessCategory } from './categories';

describe('guessCategory', () => {
  const cases: Array<[string, string]> = [
    ['Pork Liempo', 'meat'],
    ['Chicken Breast Fillet', 'poultry'],
    ['Chicken Wings 1kg', 'poultry'],
    ['Purefoods Chicken Hotdog 1kg', 'meat'],
    ['CDO Chicken Vienna Sausage', 'pantry'],
    ['Bangus (Milkfish)', 'meat'],
    ['Purefoods Hotdog 1kg', 'meat'],
    ['Kamatis', 'vegetables'],
    ['Sibuyas', 'vegetables'],
    ['Calamansi 250g', 'vegetables'],
    ['Saging Lakatan', 'vegetables'],
    ['Lucky Me Pancit Canton Chicken 60g', 'dry'],
    ['Jasmine Rice 5kg', 'dry'],
    ['Nescafe Classic 50g', 'dry'],
    ['White Sugar 1kg', 'dry'],
    ['Century Tuna Flakes in Oil', 'pantry'],
    ['Purefoods Corned Beef 210g', 'pantry'],
    ['Del Monte Tomato Sauce 250g', 'pantry'],
    ['Datu Puti Soy Sauce', 'pantry'],
    ['Bear Brand Powdered Milk 300g', 'dairy'],
    ['Eden Cheese 165g', 'dairy'],
    ['Alaska Evaporated Milk 370ml', 'dairy'],
    ['Coconut Milk 400ml', 'pantry'],
    ['Lady\'s Choice Peanut Butter', 'pantry'],
    ['Eggs Medium 12pcs', 'poultry'],
    ['Itlog na Maalat 6pcs', 'poultry'],
    ['Quail Eggs 18pcs', 'poultry'],
    ['Lucky Me Egg Noodles', 'dry'],
    ['Gardenia Classic White Bread', 'pantry'],
    ['Joy Dishwashing Liquid Lemon 250ml', 'household'],
    ['Safeguard Pure White Soap', 'household'],
    ['Downy Fabcon Sunrise Fresh', 'household'],
    ['Pampers Baby Dry L', 'household'],
    ['Item •03', 'other'],
    ['', 'other'],
  ];
  for (const [name, cat] of cases) {
    it(`"${name}" -> ${cat}`, () => expect(guessCategory(name)).toBe(cat));
  }

  it('matches whole words only', () => {
    expect(guessCategory('Cornflakes')).toBe('other'); // not "corn"
    expect(guessCategory('Hamburger buns')).toBe('other'); // not "ham"
  });
});

describe('categoryOf', () => {
  it('prefers what the shopper picked over the guess', () => {
    expect(categoryOf({ label: 'Pork Liempo', category: 'other' })).toBe('other');
    expect(categoryOf({ label: 'Pork Liempo', category: null })).toBe('meat');
    expect(categoryOf({ label: 'Pork Liempo' })).toBe('meat');
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
  it.each(CATEGORIES.map((c) => [c.label, c.color, c.ink]))('%s label is readable on its chip', (_label, color, ink) => {
    expect(contrast(color, ink)).toBeGreaterThanOrEqual(4.5);
  });
});
