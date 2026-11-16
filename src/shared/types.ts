/**
 * Data model for the JSON-file "DB".
 *
 * Each table is a JSON file containing `Record<id, Row>`.
 * All prices are whole pounds (GBP), as integers.
 * Dates are ISO strings: `yyyy-mm-dd` for days, `yyyy-mm` for month-precision.
 */

/** Land Registry property type codes. */
export type PropertyType = 'D' | 'S' | 'T' | 'F' | 'O';
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  D: 'Detached',
  S: 'Semi-detached',
  T: 'Terraced',
  F: 'Flat/Maisonette',
  O: 'Other',
};

/** Land Registry tenure ("estate type") codes. */
export type Tenure = 'F' | 'L';

export type Source = 'land_registry' | 'zoopla';

/**
 * A physical property. Holds only facts that shouldn't change over time; anything
 * that can (bedrooms, floor area, condition...) lives on Listing snapshots.
 */
export interface Property {
  /** `{POSTCODEKEY}_{street_slug}_{paon}[_{saon}]`, see ids.ts */
  id: string;
  /** Formatted postcode, e.g. "SW1P 3NG" */
  postcode: string;
  /** Primary addressable object name (house number or name), e.g. "12" or "Rose Cottage" */
  paon: string;
  /** Secondary addressable object name (flat etc.), e.g. "FLAT A" */
  saon?: string;
  street: string;
  locality?: string;
  town?: string;
  district?: string;
  county?: string;
  /** Latest known values; see Sale.propertyType/tenure for the history */
  propertyType?: PropertyType;
  tenure?: Tenure;
  /** Unique Property Reference Number (from Zoopla URLs) - strongest cross-source key */
  uprn?: string;
  zooplaUrl?: string;
  latitude?: number;
  longitude?: number;
  firstSeen: string;
  updatedAt: string;
}

export type SaleStatus = 'provisional' | 'final';

/** A single completed sale. Land Registry rows are final; Zoopla-only rows are provisional. */
export interface Sale {
  /** Land Registry transaction id, or `zoopla_{propertyId}_{yyyy-mm}` */
  id: string;
  propertyId: string;
  /** `yyyy-mm-dd` for Land Registry; Zoopla may only give `yyyy-mm` */
  date: string;
  price: number;
  status: SaleStatus;
  source: Source;
  newBuild?: boolean;
  /** Land Registry PPD category: A = standard, B = additional (repossessions, buy-to-let...) */
  ppdCategory?: 'A' | 'B';
  /** Property type / tenure as recorded for *this* transaction (they can change, e.g. a house converted to flats) */
  propertyType?: PropertyType;
  tenure?: Tenure;
  /** For provisional sales: the id of the final sale that has since replaced it */
  supersededBy?: string;
  firstSeen: string;
  updatedAt: string;
}

export type ListingType = 'sale' | 'rent';
export type Condition = 'unknown' | 'original' | 'renovated' | 'needs_work';

/**
 * One row per (property, listing event, asking price): a price reduction is a new row,
 * chained to the previous one by `previousListingId`.
 */
export interface Listing {
  /** `{propertyId}_{listingType}_{yyyy-mm}_{price}` */
  id: string;
  propertyId: string;
  /** Usually only `yyyy-mm` is known */
  listedDate: string;
  datePrecision: 'month' | 'day';
  price: number;
  listingType: ListingType;
  /** e.g. "Listed for sale", "Price reduced" - as given by the source */
  event?: string;
  zooplaListingId?: string;
  zooplaListingUrl?: string;
  previousListingId?: string;

  // Snapshot of what was being listed (floor area in square metres)
  bedrooms?: number;
  bathrooms?: number;
  receptions?: number;
  floorAreaSqm?: number;
  title?: string;
  description?: string;
  features?: string[];
  /** e.g. "Chain free", "Freehold" */
  tags?: string[];
  /** Status shown on the listing, e.g. "Sold subject to contract" */
  status?: string;
  agent?: string;
  epcRating?: string;

  /** Image paths relative to the data/ root */
  images: string[];
  /** Floor plan image paths relative to the data/ root */
  floorplans?: string[];
  /** Manual classification, to be filled in from the UI */
  condition?: Condition;

  firstSeen: string;
  updatedAt: string;
}

export interface Tables {
  properties: Record<string, Property>;
  sales: Record<string, Sale>;
  listings: Record<string, Listing>;
}

export type TableName = keyof Tables;
export const TABLE_NAMES: TableName[] = ['properties', 'sales', 'listings'];
