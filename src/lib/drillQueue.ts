export type DrillDirection = -1 | 1;

export const reconcileDrillOrder = (itemIds: string[], savedOrder: string[]) => {
  const available = new Set(itemIds);
  const seen = new Set<string>();
  const ordered = savedOrder.filter((itemId) => {
    if (!available.has(itemId) || seen.has(itemId)) return false;
    seen.add(itemId);
    return true;
  });
  for (const itemId of itemIds) {
    if (!seen.has(itemId)) ordered.push(itemId);
  }
  return ordered;
};

export const orderDrillItems = <Item extends { publicId: string }>(items: Item[], savedOrder: string[]) => {
  const byId = new Map(items.map((item) => [item.publicId, item]));
  return reconcileDrillOrder(items.map((item) => item.publicId), savedOrder)
    .map((itemId) => byId.get(itemId))
    .filter((item): item is Item => Boolean(item));
};

export const moveDrillItem = (
  fullOrder: string[],
  visibleOrder: string[],
  itemId: string,
  direction: DrillDirection,
) => {
  const visibleIndex = visibleOrder.indexOf(itemId);
  const swapId = visibleOrder[visibleIndex + direction];
  if (visibleIndex < 0 || !swapId) return fullOrder;
  const next = [...fullOrder];
  const from = next.indexOf(itemId);
  const to = next.indexOf(swapId);
  if (from < 0 || to < 0) return fullOrder;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};
