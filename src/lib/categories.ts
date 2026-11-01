// Spending categories. Every item gets one: the app guesses from the name, the shopper can change it with one tap.
//
// meat       fresh, frozen and processed meat, poultry and seafood (liempo, manok, bangus, hotdog, longganisa)
// vegetables vegetables, fruit and fresh herbs (kamatis, kangkong, saging, calamansi)
// pantry     packaged food that isn't a staple: canned goods, sauces, oil, dairy, eggs, bread, snacks, drinks
// dry        staples: rice, noodles, pasta, flour, sugar, coffee, cereal, dried beans
// household  things you don't eat: detergent, soap, shampoo, tissue, diapers
// other      anything the app can't place

export type CategoryId = 'meat' | 'vegetables' | 'pantry' | 'dry' | 'household' | 'other';

export interface Category {
  id: CategoryId;
  label: string;
  color: string;
  /** Text color on a chip filled with `color`. Picked so the label stays at 4.5:1 or better. */
  ink: string;
}

const WHITE = '#ffffff';
const NAVY = '#1a3555'; // same as --navy in index.css

export const CATEGORIES: Category[] = [
  { id: 'meat', label: 'Meat & seafood', color: '#c2410c', ink: WHITE },
  // A step darker than #16a34a: white on the old green was 3.3:1.
  { id: 'vegetables', label: 'Vegetables & fruit', color: '#15803d', ink: WHITE },
  { id: 'pantry', label: 'Pantry', color: '#d4a017', ink: NAVY },
  { id: 'dry', label: 'Dry goods', color: '#7c5c3b', ink: WHITE },
  { id: 'household', label: 'Household', color: '#2563eb', ink: WHITE },
  { id: 'other', label: 'Other', color: '#9ca3af', ink: NAVY },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>;

// Checked in this order, first match wins. Order settles the overlaps:
// "Lucky Me chicken" is noodles (dry), "corned beef" and "Century tuna" are canned (pantry),
// "tomato sauce" is a sauce (pantry), "chicken breast" is meat.
const RULES: Array<[CategoryId, string[]]> = [
  ['household', [
    'detergent', 'sabon', 'soap', 'shampoo', 'conditioner', 'toothpaste', 'toothbrush', 'colgate', 'tissue', 'toilet paper',
    'diaper', 'diapers', 'napkin', 'wipes', 'bleach', 'zonrox', 'downy', 'surf', 'tide', 'ariel', 'champion', 'dishwashing',
    'joy', 'safeguard', 'palmolive', 'lotion', 'deodorant', 'alcohol', 'trash bag', 'garbage bag', 'battery', 'batteries',
    'sponge', 'fabcon', 'fabric conditioner', 'sunsilk', 'cream silk', 'creamsilk', 'head & shoulders', 'modess', 'whisper',
    'pampers', 'eq', 'huggies', 'baygon', 'insecticide', 'mosquito', 'katol', 'lysol', 'domex', 'glade', 'foil', 'cling wrap',
  ]],
  ['dry', [
    'rice', 'bigas', 'jasmine', 'dinorado', 'sinandomeng', 'noodle', 'noodles', 'pancit', 'canton', 'bihon', 'sotanghon',
    'miki', 'misua', 'lucky me', 'payless', 'nissin', 'ramen', 'pasta', 'spaghetti', 'macaroni', 'elbow', 'flour', 'harina',
    'sugar', 'asukal', 'coffee', 'kape', 'nescafe', 'kopiko', 'great taste', 'cereal', 'oats', 'oatmeal', 'quaker', 'mongo',
    'munggo', 'monggo', 'cornstarch', 'salt', 'asin', 'breadcrumbs',
  ]],
  ['pantry', [
    'canned', 'de lata', 'sardines', 'sardinas', 'ligo', 'mega', 'corned', 'century', '555', 'tuna', 'pork and beans',
    'meat loaf', 'luncheon', 'spam', 'vienna', 'sauce', 'toyo', 'soy', 'suka', 'vinegar', 'patis', 'bagoong', 'ketchup',
    'catsup', 'mayo', 'mayonnaise', 'oil', 'mantika', 'butter', 'margarine', 'cheese', 'eden', 'milk', 'gatas', 'bear brand',
    'alaska', 'evap', 'evaporated', 'condensed', 'cream', 'egg', 'eggs', 'itlog', 'bread', 'tinapay', 'pandesal', 'loaf',
    'gardenia', 'biscuit', 'biscuits', 'cracker', 'crackers', 'skyflakes', 'chips', 'snack', 'chocolate', 'juice', 'soda',
    'coke', 'pepsi', 'sprite', 'royal', 'softdrinks', 'water', 'tubig', 'tea', 'milo', 'ovaltine', 'knorr', 'magic sarap',
    'maggi', 'mama sita', 'seasoning', 'bouillon', 'cubes', 'paminta', 'black pepper', 'jam', 'peanut butter', 'lady s choice',
    'honey', 'yogurt', 'ice cream', 'gata', 'coconut milk', 'tomato paste',
  ]],
  ['meat', [
    'pork', 'baboy', 'liempo', 'kasim', 'pigue', 'pata', 'chicken', 'manok', 'beef', 'baka', 'giniling', 'ground', 'meat',
    'karne', 'steak', 'wings', 'drumstick', 'thigh', 'breast', 'fish', 'isda', 'bangus', 'tilapia', 'galunggong', 'tamban',
    'salmon', 'lapu', 'shrimp', 'hipon', 'squid', 'pusit', 'crab', 'alimango', 'alimasag', 'tahong', 'mussels', 'seafood',
    'hotdog', 'hot dog', 'longganisa', 'longanisa', 'tocino', 'tapa', 'bacon', 'ham', 'sausage', 'chorizo', 'embutido',
    'lechon', 'atay', 'liver',
  ]],
  ['vegetables', [
    'vegetable', 'vegetables', 'gulay', 'kamatis', 'tomato', 'tomatoes', 'sibuyas', 'onion', 'onions', 'bawang', 'garlic',
    'luya', 'ginger', 'patatas', 'potato', 'potatoes', 'carrot', 'carrots', 'karot', 'repolyo', 'cabbage', 'pechay',
    'petsay', 'kangkong', 'sitaw', 'talong', 'eggplant', 'ampalaya', 'kalabasa', 'squash', 'sayote', 'okra', 'malunggay',
    'lettuce', 'cucumber', 'pipino', 'sili', 'chili', 'calamansi', 'kalamansi', 'banana', 'bananas', 'saging', 'mango',
    'mangga', 'apple', 'apples', 'orange', 'oranges', 'dalandan', 'papaya', 'pineapple', 'pinya', 'grapes', 'watermelon',
    'pakwan', 'avocado', 'mushroom', 'mushrooms', 'corn', 'mais', 'bell pepper', 'labanos', 'radish', 'broccoli', 'celery',
    'kintsay', 'spring onion', 'dahon', 'lemon', 'lemongrass', 'tanglad', 'herbs', 'fruit', 'prutas',
  ]],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = RULES.map(([id, words]) => [id, new RegExp(`(^|[^a-z0-9])(${words.map(escape).join('|')})(?=$|[^a-z0-9])`)] as const);

/** Best guess from an item name. Returns 'other' when nothing matches. */
export function guessCategory(label: string): CategoryId {
  const name = label.toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return 'other';
  for (const [id, re] of COMPILED) if (re.test(name)) return id;
  return 'other';
}

export function categoryOf(item: { label: string; category?: CategoryId | null }): CategoryId {
  return item.category ?? guessCategory(item.label);
}
