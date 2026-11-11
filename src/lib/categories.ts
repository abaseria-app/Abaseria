// Spending categories. Every item gets one: the shared database's when the barcode is known, otherwise the app
// guesses from the name, and the shopper can change it with one tap.
//
// The 16 ids are the exact values stored in products.category (Brad's list, Nov 11 2026). Eggs sit with dairy,
// poultry with meat and seafood. "other" never reaches the database: it means the app couldn't place an item and
// nobody picked one, and it uploads as no category.

export const CATEGORY_IDS = [
  'pantry staples',
  'fruits & vegetables',
  'meat, poultry & seafood',
  'dairy & eggs',
  'canned & preserved food',
  'cooking essentials & condiments',
  'bread & bakery',
  'snacks, candies & sweets',
  'beverages',
  'frozen & ready-to-eat food',
  'household & cleaning supplies',
  'personal care & hygiene',
  'baby & kids',
  'health & wellness',
  'pet supplies',
  'baking and desserts',
] as const;

export type ShelfCategoryId = (typeof CATEGORY_IDS)[number];
export type CategoryId = ShelfCategoryId | 'other';

/** The 8 ids the app used before Nov 11 2026. Phones and the live database may still hold them. */
export type LegacyCategoryId = 'meat' | 'poultry' | 'vegetables' | 'dairy' | 'pantry' | 'dry' | 'household';

export interface Category {
  id: CategoryId;
  label: string;
  color: string;
  /** Text color on a chip filled with `color`. Picked so the label stays at 4.5:1 or better. */
  ink: string;
}

const WHITE = '#ffffff';
const NAVY = '#1a3555'; // same as --navy in index.css

/** The 16 a shopper can pick, in Brad's order. Explore shows one tile each. */
export const CATEGORIES: Category[] = [
  { id: 'pantry staples', label: 'Pantry staples', color: '#d4a017', ink: NAVY },
  { id: 'fruits & vegetables', label: 'Fruits & vegetables', color: '#15803d', ink: WHITE },
  { id: 'meat, poultry & seafood', label: 'Meat, poultry & seafood', color: '#c2410c', ink: WHITE },
  { id: 'dairy & eggs', label: 'Dairy & eggs', color: '#7dd3fc', ink: NAVY },
  { id: 'canned & preserved food', label: 'Canned & preserved food', color: '#475569', ink: WHITE },
  { id: 'cooking essentials & condiments', label: 'Cooking essentials & condiments', color: '#92400e', ink: WHITE },
  { id: 'bread & bakery', label: 'Bread & bakery', color: '#fdba74', ink: NAVY },
  // Deep pink from the logo's wordmark.
  { id: 'snacks, candies & sweets', label: 'Snacks, candies & sweets', color: '#be185d', ink: WHITE },
  { id: 'beverages', label: 'Beverages', color: '#0e7490', ink: WHITE },
  { id: 'frozen & ready-to-eat food', label: 'Frozen & ready-to-eat food', color: '#a5b4fc', ink: NAVY },
  { id: 'household & cleaning supplies', label: 'Household & cleaning supplies', color: '#2563eb', ink: WHITE },
  { id: 'personal care & hygiene', label: 'Personal care & hygiene', color: '#f9a8d4', ink: NAVY },
  { id: 'baby & kids', label: 'Baby & kids', color: '#bbf7d0', ink: NAVY },
  { id: 'health & wellness', label: 'Health & wellness', color: '#0f766e', ink: WHITE },
  { id: 'pet supplies', label: 'Pet supplies', color: '#4d7c0f', ink: WHITE },
  // Dark purple from the app's button borders; no other category is purple.
  { id: 'baking and desserts', label: 'Baking & desserts', color: '#4b1f6f', ink: WHITE },
];

export const OTHER: Category = { id: 'other', label: 'Not sorted yet', color: '#9ca3af', ink: NAVY };

export const CATEGORY_BY_ID = Object.fromEntries([...CATEGORIES, OTHER].map((c) => [c.id, c])) as Record<CategoryId, Category>;

// Checked in this order, first match wins. Order settles the overlaps, following how Brad's product sheets file them:
// "Lucky Me Egg Noodles" is a staple, not eggs; "Century Tuna" and "CDO Chicken Vienna Sausage" are canned;
// "tomato sauce", "coconut milk" and "peanut butter" aren't vegetables or dairy; "ice cream" is frozen;
// powdered milk and coffee are beverages; flour is baking; "Pedigree beef" is pet food; "chicken hotdog" is meat.
const RULES: Array<[ShelfCategoryId, string[]]> = [
  // Baby versions of personal care first: "Johnson's Baby Shampoo" is a baby item.
  ['baby & kids', [
    'diaper', 'diapers', 'pampers', 'eq', 'huggies', 'baby wipes', 'wipes', 'enfamil', 'enfagrow', 'promil', 's-26',
    'bonna', 'lactum', 'nursery', 'infant', 'baby oil',
    'baby powder', 'baby shampoo', 'baby lotion', 'baby bath', 'baby soap', 'baby cologne',
  ]],
  ['personal care & hygiene', [
    'shampoo', 'conditioner', 'toothpaste', 'toothbrush', 'colgate', 'close up', 'safeguard', 'palmolive', 'bath soap',
    'lotion', 'deodorant', 'sunsilk', 'cream silk', 'creamsilk', 'head & shoulders', 'modess', 'whisper', 'sanitary',
    'feminine', 'razor', 'mouthwash', 'cologne', 'body wash', 'facial', 'hygiene',
  ]],
  ['household & cleaning supplies', [
    'detergent', 'sabon', 'dishwashing', 'bleach', 'zonrox', 'downy', 'surf', 'tide', 'ariel', 'champion', 'joy',
    'fabcon', 'fabric conditioner', 'trash bag', 'garbage bag', 'battery', 'batteries', 'sponge', 'baygon',
    'insecticide', 'mosquito', 'katol', 'lysol', 'domex', 'glade', 'foil', 'cling wrap', 'tissue', 'toilet paper',
    'napkin', 'soap', 'cleaner',
  ]],
  ['health & wellness', [
    'alcohol', 'vitamin', 'vitamins', 'biogesic', 'paracetamol', 'neozep', 'bioflu', 'enervon', 'centrum', 'ceelin',
    'medicine', 'band-aid', 'bandage', 'multivitamins', 'cough', 'antacid',
  ]],
  ['canned & preserved food', [
    'canned', 'de lata', 'sardines', 'sardine', 'sardinas', 'ligo', 'mega', '555', 'century', 'tuna', 'corned',
    'luncheon', 'spam', 'vienna', 'meat loaf', 'pork and beans', 'fruit cocktail', 'cream style', 'creamed corn',
    'kaong', 'nata de coco', 'pickles', 'atchara',
  ]],
  ['frozen & ready-to-eat food', ['frozen', 'ice cream', 'selecta', 'ready to eat', 'ready-to-eat', 'siomai', 'dumplings']],
  ['baking and desserts', [
    'flour', 'harina', 'baking', 'yeast', 'cornstarch', 'gelatin', 'gulaman', 'cake mix', 'icing', 'frosting', 'vanilla',
    'all purpose cream', 'whipping cream', 'leche flan', 'graham', 'sprinkles',
  ]],
  ['pantry staples', [
    'rice', 'bigas', 'jasmine', 'dinorado', 'sinandomeng', 'noodle', 'noodles', 'pancit', 'canton', 'bihon',
    'sotanghon', 'miki', 'misua', 'lucky me', 'payless', 'nissin', 'ramen', 'pasta', 'spaghetti', 'macaroni', 'elbow',
    'sugar', 'asukal', 'cereal', 'oats', 'oatmeal', 'quaker', 'mongo', 'munggo', 'monggo', 'breadcrumbs',
    'peanut butter', 'condensed', 'soup',
  ]],
  ['cooking essentials & condiments', [
    'sauce', 'toyo', 'soy', 'suka', 'vinegar', 'patis', 'bagoong', 'ketchup', 'catsup', 'mayo', 'mayonnaise', 'oil',
    'mantika', 'knorr', 'magic sarap', 'maggi', 'mama sita', 'seasoning', 'bouillon', 'cubes', 'paminta',
    'black pepper', 'salt', 'asin', 'tomato paste', 'gata', 'coconut milk', 'coconut cream', 'dressing', 'marinade',
  ]],
  ['beverages', [
    'juice', 'soda', 'coke', 'pepsi', 'sprite', 'royal', 'softdrinks', 'water', 'tubig', 'tea', 'milo', 'ovaltine',
    'coffee', 'kape', 'nescafe', 'kopiko', 'great taste', 'drink', 'drinks', 'gatorade', 'c2', 'zesto', 'tang',
    'powdered milk', 'bear brand', 'beer', 'san miguel',
  ]],
  ['dairy & eggs', [
    'milk', 'gatas', 'alaska', 'evap', 'evaporated', 'cheese', 'eden', 'butter', 'margarine', 'yogurt', 'yoghurt',
    'dairy', 'kesong puti', 'egg', 'eggs', 'itlog', 'balut', 'penoy',
  ]],
  ['bread & bakery', [
    'bread', 'tinapay', 'pandesal', 'loaf', 'gardenia', 'ensaymada', 'monay', 'bun', 'buns', 'bakery', 'bibingka', 'siopao',
  ]],
  ['snacks, candies & sweets', [
    'chips', 'snack', 'snacks', 'chocolate', 'biscuit', 'biscuits', 'cracker', 'crackers', 'skyflakes', 'candy',
    'candies', 'cookies', 'wafer', 'gum', 'mallows', 'polvoron', 'piattos', 'nova', 'chippy', 'oishi', 'jelly', 'cake',
  ]],
  // Processed meat before pet food, so "hot dog" stays food.
  ['meat, poultry & seafood', [
    'hotdog', 'hot dog', 'longganisa', 'longanisa', 'tocino', 'tapa', 'bacon', 'ham', 'sausage', 'chorizo', 'embutido',
  ]],
  ['pet supplies', ['pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'puppy', 'kitten', 'pedigree', 'whiskas', 'vitality', 'feeds', 'litter']],
  ['meat, poultry & seafood', [
    'chicken', 'manok', 'wings', 'drumstick', 'drumsticks', 'thigh', 'thighs', 'breast', 'nuggets', 'turkey', 'duck',
    'pato', 'itik', 'quail', 'pugo', 'poultry', 'pork', 'baboy', 'liempo', 'kasim', 'pigue', 'pata', 'beef', 'baka',
    'giniling', 'ground', 'meat', 'karne', 'steak', 'fish', 'isda', 'bangus', 'tilapia', 'galunggong', 'tamban',
    'salmon', 'lapu', 'shrimp', 'hipon', 'squid', 'pusit', 'crab', 'alimango', 'alimasag', 'tahong', 'mussels',
    'seafood', 'lechon', 'atay', 'liver',
  ]],
  ['fruits & vegetables', [
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

// Where an old id lands when the name gives no better answer.
const LEGACY_FALLBACK: Record<LegacyCategoryId, CategoryId> = {
  meat: 'meat, poultry & seafood',
  poultry: 'meat, poultry & seafood',
  vegetables: 'fruits & vegetables',
  dairy: 'dairy & eggs',
  pantry: 'pantry staples',
  dry: 'pantry staples',
  household: 'household & cleaning supplies',
};

const isCategoryId = (c: string): c is CategoryId => c in CATEGORY_BY_ID;

/**
 * Any stored category value as one of today's ids. Old ids are re-read from the item's name, because one old
 * bucket split into several ("household" is now household, personal care or baby; "pantry" is canned, condiments,
 * bread, snacks or drinks). Unknown or missing values are guessed from the name.
 */
export function toCategory(raw: string | null | undefined, label: string): CategoryId {
  if (raw && isCategoryId(raw)) return raw;
  const guess = guessCategory(label);
  if (raw && raw in LEGACY_FALLBACK && guess === 'other') return LEGACY_FALLBACK[raw as LegacyCategoryId];
  return guess;
}

export function categoryOf(item: { label: string; category?: string | null }): CategoryId {
  return toCategory(item.category, item.label);
}

/** What goes into products.category: one of the 16, or nothing when the item isn't sorted. */
export const sharedCategory = (id: CategoryId): ShelfCategoryId | null => (id === 'other' ? null : id);
