import { createServerApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const app = createServerApp();

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});