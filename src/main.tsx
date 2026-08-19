import "@fontsource-variable/inter";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RehearsalApp } from "./app/RehearsalApp";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RehearsalApp />
  </StrictMode>,
);
