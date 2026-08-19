import "@fontsource-variable/inter";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProfileGate } from "./features/auth/ProfileGate";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProfileGate />
  </StrictMode>,
);
