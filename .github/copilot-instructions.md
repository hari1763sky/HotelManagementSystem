# Haven Hotel Management

- Frontend: React 18, Vite, React Router, Lucide icons.
- Backend: Node.js 24+, Express, SQLite via the built-in `node:sqlite` module.
- Authentication: bcrypt password hashes, JWT in HTTP-only cookies, Zod request validation.
- Run both apps with `npm run dev` from the workspace root after installing dependencies.
- The first account registered becomes the hotel administrator; later accounts are staff. All authenticated users can access the operations dashboard.
- Never commit `server/.env` or the SQLite database. Set a strong `JWT_SECRET` before deployment.
