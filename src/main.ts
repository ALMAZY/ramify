import { App } from "./app";

const app = new App();
(window as any).ramify = app; // handy for debugging in devtools
void app.start();
