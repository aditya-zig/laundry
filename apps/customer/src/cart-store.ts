// Reactive basket store local to the customer app. Same CartLine model as
// src/cart.ts (basket caps and merge rules stay there); screens subscribe
// with useSyncExternalStore so the home, the floating bar and the sheet all
// read one snapshot instead of importing a mutable singleton.
import { addLine, removeLine, setGarmentQuantity, updateQuantity, type CartLine } from "./cart";

let lines: CartLine[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getBasketLines(): CartLine[] {
  return lines;
}

export type Unsubscribe = () => void;

export function subscribeBasket(listener: () => void): Unsubscribe {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetBasket(next: CartLine[] = []): void {
  lines = next;
  emit();
}

/** Adds a line through addLine (throws with the basket cap messages). */
export function addBasketLine(line: CartLine): void {
  lines = addLine(lines, line);
  emit();
}

export function setBasketQuantity(index: number, quantity: number): void {
  lines = updateQuantity(lines, index, quantity);
  emit();
}

export function removeBasketLine(index: number): void {
  lines = removeLine(lines, index);
  emit();
}

/** Tile/sheet stepper for one service+garment pair (see setGarmentQuantity). */
export function setBasketGarmentQuantity(serviceId: string, garmentTypeId: string, next: number): void {
  lines = setGarmentQuantity(lines, serviceId, garmentTypeId, next);
  emit();
}
