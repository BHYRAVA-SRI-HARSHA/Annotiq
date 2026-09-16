import "dotenv/config";
import { createApp } from "./app";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Annotiq API listening on http://localhost:${PORT}`);
});
