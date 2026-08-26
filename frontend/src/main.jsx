
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// Friendly self-XSS warning. This is only a deterrent; browser developer
// tools can always inspect client-side JavaScript, so no secret belongs here.
if (import.meta.env.PROD) {
  console.log("%cBOM Tool", "font-size: 24px; font-weight: bold;");
  console.log("Developer console access does not grant server access. Never paste code here that someone else gives you.");
}
