/**
 * First-run scaffold.
 *
 * These names are written into the database as the user's own data, so they are
 * generated once, in whatever language the interface was in at first launch.
 * Switching language afterwards never rewrites them — otherwise carefully
 * renamed categories would silently get translated.
 */

export const seed = {
  /* Location tree: parents always come before their children */
  home: 'Home',
  bedroom: 'Bedroom',
  livingRoom: 'Living room',
  kitchen: 'Kitchen',
  study: 'Study',
  bathroom: 'Bathroom',
  balcony: 'Balcony',
  storage: 'Storage room',
  wardrobe: 'Wardrobe',
  nightstand: 'Nightstand',
  underBed: 'Under-bed storage',
  tvStand: 'TV stand',
  sideboard: 'Sideboard',
  shoeCabinet: 'Shoe cabinet',
  desk: 'Desk',
  bookshelf: 'Bookshelf',
  cupboard: 'Cupboard',
  fridge: 'Fridge',
  storageBox: 'Storage box',
  shelf: 'Shelf',

  /* Top-level categories */
  catClothing: 'Clothing',
  catElectronics: 'Electronics',
  catBooks: 'Books',
  catKitchen: 'Kitchenware',
  catDaily: 'Household',
  catMedicine: 'Medicine',
  catStationery: 'Stationery',
  catTools: 'Tools',
  catKeepsake: 'Keepsakes',
  catOther: 'Other',

  /* Attribute library */
  attrBrand: 'Brand',
  attrPurchaseDate: 'Purchased',
  attrPrice: 'Price',
  attrPriceUnit: 'USD',
  attrColor: 'Colour',
  attrSize: 'Size',
  colorBlack: 'Black',
  colorWhite: 'White',
  colorGrey: 'Grey',
  colorWood: 'Wood',
  colorColorful: 'Colourful',

  /* Tags */
  tagGiveAway: 'Give away',
  tagReluctant: 'Hard to let go',
  tagToRepair: 'Needs repair',
}
