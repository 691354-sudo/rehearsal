export type LibraryActionsPlacement = {
  left: number;
  placement: "above" | "below";
  top: number;
};

export const placeLibraryActions = (
  anchor: Pick<DOMRect, "top" | "right" | "bottom">,
  menu: Pick<DOMRect, "width" | "height">,
  viewport: { width: number; bottom: number },
  margin = 8,
  gap = 6,
): LibraryActionsPlacement => {
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - menu.height;
  const canOpenBelow = below + menu.height <= viewport.bottom - margin;
  const top = canOpenBelow ? below : Math.max(margin, Math.min(above, viewport.bottom - margin - menu.height));
  const left = Math.max(margin, Math.min(anchor.right - menu.width, viewport.width - margin - menu.width));
  return { left, placement: canOpenBelow ? "below" : "above", top };
};
