import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PlatformApp from "./PlatformApp";
import "./styles.css";

const RootApp = window.location.pathname === "/platform" ||
  window.location.pathname.startsWith("/platform/")
  ? PlatformApp
  : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
