import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { InterviewProvider } from "./context/InterviewContext";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <InterviewProvider>
      <App />
    </InterviewProvider>
  </StrictMode>
);