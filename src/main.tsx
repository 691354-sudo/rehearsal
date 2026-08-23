import "@fontsource-variable/golos-text";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { PwaUpdatePrompt } from "./app/PwaUpdatePrompt";
import { ProfileGate } from "./features/auth/ProfileGate";
import "./styles/index.css";
import "./styles/vietnamese-font.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ProfileGate />
      <PwaUpdatePrompt />
    </AppErrorBoundary>
  </StrictMode>,
);
