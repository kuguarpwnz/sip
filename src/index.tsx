import { render } from "solid-js/web";
import "./app.css";
import App from "./App";

const mount = () => render(() => <App />, document.getElementById("root") as HTMLElement);

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  void import("./dev/fake-host").then(mount);
} else {
  mount();
}
