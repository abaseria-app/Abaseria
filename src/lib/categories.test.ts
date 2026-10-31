import { describe, expect, it } from 'vitest';
import { categoryOf, guessCategory } from './categories';

describe('guessCategory', () => {
  const cases: Array<[string, string]> = [
    ['Pork Liempo', 'meat'],
    ['Chicken Breast Fillet', 'meat'],
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
    ['Bear Brand Powdered Milk 300g', 'pantry'],
    ['Eggs Medium 12pcs', 'pantry'],
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
