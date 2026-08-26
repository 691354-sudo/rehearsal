type TelegramInset = { top: number; bottom: number; left: number; right: number };

interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  BackButton: TelegramBackButton;
  ready(): void;
  expand(): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
