import "@fontsource-variable/manrope";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DesignLab } from "./components/DesignLab";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.hash === "#legacy" ? <App /> : <DesignLab />}
  </StrictMode>,
);
