type DialogPointer = {
  target: EventTarget | null; currentTarget: HTMLDialogElement; clientX: number; clientY: number;
};
const onBackdrop = (event: DialogPointer) => {
  if (event.target !== event.currentTarget) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
};

export function createCardDialogDismiss() {
  let startedOutside = false;
  return {
    onPointerDownCapture(event: DialogPointer & { button: number }) {
      startedOutside = event.button === 0 && onBackdrop(event);
    },
    onPointerCancel() { startedOutside = false; },
    shouldClose(event: DialogPointer) {
      const close = startedOutside && onBackdrop(event);
      startedOutside = false;
      return close;
    },
  };
}
