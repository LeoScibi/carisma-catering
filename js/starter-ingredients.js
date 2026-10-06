// A starter set of common Italian kitchen and bar ingredients, for the
// "Add many" screen. Each is [name, unit (g / ml / each), allergens]. Allergens are only the
// obvious, generic ones (e.g. Milk in cheese, Sulphites in wine); products vary, so they must be
// checked against each supplier's spec sheet before relying on them for menus.

const STORAGE = {
  Cheese: 'Chilled', Dairy: 'Chilled', Charcuterie: 'Chilled', Meat: 'Chilled', Fish: 'Chilled',
  Veg: 'Chilled', Fruit: 'Ambient', 'Herbs & spices': 'Ambient', 'Dry goods': 'Ambient',
  'Oils & vinegars': 'Ambient', Bakery: 'Ambient', Wine: 'Cellar', Spirits: 'Ambient', Beer: 'Chilled',
  'Soft drinks': 'Ambient',
};

const LIST = {
  Cheese: [
    ['Burrata', 'g', 'Milk'], ['Stracciatella', 'g', 'Milk'], ['Mozzarella di bufala', 'g', 'Milk'],
    ['Parmigiano Reggiano', 'g', 'Milk'], ['Pecorino Romano', 'g', 'Milk'], ['Comté', 'g', 'Milk'],
    ['Gorgonzola', 'g', 'Milk'], ['Taleggio', 'g', 'Milk'], ['Ricotta', 'g', 'Milk'],
    ['Goat’s cheese', 'g', 'Milk'], ['Manchego', 'g', 'Milk'], ['Brillat-Savarin', 'g', 'Milk'],
  ],
  Dairy: [
    ['Unsalted butter', 'g', 'Milk'], ['Salted butter', 'g', 'Milk'], ['Double cream', 'ml', 'Milk'],
    ['Crème fraîche', 'g', 'Milk'], ['Whole milk', 'ml', 'Milk'], ['Greek yoghurt', 'g', 'Milk'],
    ['Mascarpone', 'g', 'Milk'], ['Free-range eggs', 'each', 'Eggs'],
  ],
  Charcuterie: [
    ['Prosciutto di Parma', 'g', ''], ['Jamón serrano', 'g', ''], ['Bresaola', 'g', ''], ['Coppa', 'g', ''],
    ['Salami Milano', 'g', ''], ['Mortadella', 'g', ''], ['Finocchiona', 'g', ''], ['Nduja', 'g', ''],
    ['Chorizo', 'g', ''], ['Lardo', 'g', ''],
  ],
  Meat: [
    ['Chicken thighs', 'g', ''], ['Beef bavette', 'g', ''], ['Pork belly', 'g', ''], ['Lamb rump', 'g', ''],
    ['Duck breast', 'g', ''],
  ],
  Fish: [
    ['Cantabrian anchovies', 'g', 'Fish'], ['Boquerones', 'g', 'Fish'], ['Smoked salmon', 'g', 'Fish'],
    ['Tuna in olive oil', 'g', 'Fish'], ['Sardines', 'g', 'Fish'], ['Salt cod', 'g', 'Fish'],
    ['Bottarga', 'g', 'Fish'], ['Octopus', 'g', 'Molluscs'], ['Squid', 'g', 'Molluscs'],
    ['Mussels', 'g', 'Molluscs'], ['Oysters', 'each', 'Molluscs'], ['Prawns', 'g', 'Crustaceans'],
  ],
  Veg: [
    ['Datterini tomatoes', 'g', ''], ['Heritage tomatoes', 'g', ''], ['Shallots', 'g', ''], ['Onions', 'g', ''],
    ['Red onions', 'g', ''], ['Garlic', 'g', ''], ['Potatoes', 'g', ''], ['New potatoes', 'g', ''],
    ['Courgettes', 'g', ''], ['Aubergines', 'g', ''], ['Red peppers', 'g', ''], ['Fennel', 'g', ''],
    ['Celery', 'g', 'Celery'], ['Carrots', 'g', ''], ['Leeks', 'g', ''], ['Rocket', 'g', ''],
    ['Radicchio', 'g', ''], ['Little gem lettuce', 'each', ''], ['Spinach', 'g', ''], ['Wild mushrooms', 'g', ''],
    ['Chestnut mushrooms', 'g', ''], ['Asparagus', 'g', ''], ['Peas', 'g', ''], ['Broad beans', 'g', ''],
    ['Radishes', 'g', ''], ['Cucumber', 'each', ''], ['Red chillies', 'g', ''],
  ],
  Fruit: [
    ['Lemons', 'each', ''], ['Limes', 'each', ''], ['Oranges', 'each', ''], ['Figs', 'each', ''],
    ['Pears', 'each', ''], ['Apples', 'each', ''], ['Grapes', 'g', ''],
  ],
  'Herbs & spices': [
    ['Flat-leaf parsley', 'g', ''], ['Basil', 'g', ''], ['Mint', 'g', ''], ['Thyme', 'g', ''],
    ['Rosemary', 'g', ''], ['Sage', 'g', ''], ['Chives', 'g', ''], ['Dill', 'g', ''], ['Dried oregano', 'g', ''],
    ['Bay leaves', 'g', ''], ['Black peppercorns', 'g', ''], ['Maldon sea salt', 'g', ''], ['Fine salt', 'g', ''],
    ['Chilli flakes', 'g', ''], ['Fennel seeds', 'g', ''], ['Smoked paprika', 'g', ''], ['Cumin', 'g', ''],
    ['Nutmeg', 'g', ''],
  ],
  'Dry goods': [
    ['Plain flour', 'g', 'Gluten'], ['00 flour', 'g', 'Gluten'], ['Semolina', 'g', 'Gluten'],
    ['Panko breadcrumbs', 'g', 'Gluten'], ['Dried pasta', 'g', 'Gluten'], ['Arborio rice', 'g', ''],
    ['Caster sugar', 'g', ''], ['Icing sugar', 'g', ''], ['Honey', 'g', ''], ['Dijon mustard', 'g', 'Mustard'],
    ['Wholegrain mustard', 'g', 'Mustard'], ['Capers', 'g', ''], ['Caperberries', 'g', ''],
    ['Gordal olives', 'g', ''], ['Nocellara olives', 'g', ''], ['Taggiasca olives', 'g', ''], ['Kalamata olives', 'g', ''],
    ['Guindilla peppers', 'g', ''], ['Cornichons', 'g', ''], ['Sun-dried tomatoes', 'g', ''],
    ['Tinned tomatoes', 'g', ''], ['Tomato passata', 'g', ''], ['Chickpeas', 'g', ''], ['Cannellini beans', 'g', ''],
    ['Puy lentils', 'g', ''], ['Marcona almonds', 'g', 'Tree nuts'], ['Hazelnuts', 'g', 'Tree nuts'],
    ['Pistachios', 'g', 'Tree nuts'], ['Walnuts', 'g', 'Tree nuts'], ['Pine nuts', 'g', ''],
    ['Membrillo', 'g', ''], ['Dark chocolate', 'g', ''], ['Grissini', 'g', 'Gluten'], ['Crackers', 'g', 'Gluten'],
  ],
  'Oils & vinegars': [
    ['Extra virgin olive oil', 'ml', ''], ['Olive oil (cooking)', 'ml', ''], ['Rapeseed oil', 'ml', ''],
    ['Sunflower oil (frying)', 'ml', ''], ['Red wine vinegar', 'ml', 'Sulphites'], ['White wine vinegar', 'ml', 'Sulphites'],
    ['Sherry vinegar', 'ml', 'Sulphites'], ['Balsamic vinegar', 'ml', 'Sulphites'],
  ],
  Bakery: [
    ['Sourdough loaf', 'each', 'Gluten'], ['Baguette', 'each', 'Gluten'], ['Focaccia', 'each', 'Gluten'],
    ['Brioche', 'each', 'Gluten, Eggs, Milk'],
  ],
  Wine: [
    ['House red wine', 'ml', 'Sulphites'], ['House white wine', 'ml', 'Sulphites'], ['House rosé', 'ml', 'Sulphites'],
    ['House sparkling wine', 'ml', 'Sulphites'], ['Cooking white wine', 'ml', 'Sulphites'], ['Cooking red wine', 'ml', 'Sulphites'],
  ],
  Spirits: [
    ['Gin', 'ml', ''], ['Vodka', 'ml', ''], ['Campari', 'ml', ''], ['Aperol', 'ml', ''],
    ['Sweet vermouth', 'ml', 'Sulphites'], ['Dry vermouth', 'ml', 'Sulphites'], ['Grappa', 'ml', ''],
    ['Limoncello', 'ml', ''], ['Angostura bitters', 'ml', ''],
  ],
  Beer: [['Lager', 'ml', 'Gluten'], ['Pale ale', 'ml', 'Gluten']],
  'Soft drinks': [
    ['Sparkling water', 'ml', ''], ['Still water', 'ml', ''], ['Soda water', 'ml', ''], ['Tonic water', 'ml', ''],
    ['Fresh orange juice', 'ml', ''], ['Lemonade', 'ml', ''], ['Cola', 'ml', ''], ['Ginger beer', 'ml', ''],
  ],
};

/** Flat list: { NAME, CATEGORY, UNIT, ALLERGENS, STORAGE }. */
export const STARTER_INGREDIENTS = Object.entries(LIST).flatMap(([category, items]) =>
  items.map(([name, unit, allergens]) => ({ NAME: name, CATEGORY: category, UNIT: unit, ALLERGENS: allergens, STORAGE: STORAGE[category] })));

const DRINK_CATEGORIES = ['Wine', 'Spirits', 'Beer', 'Soft drinks'];
const COUNTED = /\b(eggs?|lemons?|limes?|oranges?|loaf|loaves|baguettes?|oysters?|buns?|rolls?|cans?|bottles?)\b/i;

/** Best guess at how a typed-in ingredient is measured. */
export function guessUnit(name, category) {
  if (DRINK_CATEGORIES.includes(category) || /\b(oil|vinegar|juice|milk|cream|wine|water|syrup)\b(?!\s+(cheese|crackers?|biscuits?))/i.test(name)) return 'ml';
  if (COUNTED.test(name)) return 'each';
  return 'g';
}
