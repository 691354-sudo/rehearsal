import "@fontsource-variable/golos-text";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PwaUpdatePrompt } from "./app/PwaUpdatePrompt";
import { ProfileGate } from "./features/auth/ProfileGate";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProfileGate />
    <PwaUpdatePrompt />
  </StrictMode>,
);
