import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { purgeExpired } from "@/api/dataroom";
import { App } from "@/app";
import "./index.css";

// Sweep tombstones whose undo window expired in a previous session.
void purgeExpired();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
