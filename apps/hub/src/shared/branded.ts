// A constrained string's type: only its parser makes one. Shared, so main and the Hub Chrome brand
// the same way.

declare const brand: unique symbol;
export type Branded<T, Name extends string> = T & { readonly [brand]: Name };
