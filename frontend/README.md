# Studio Tools — Frontend

React + Vite + TypeScript (strict) SPA styled with Tailwind CSS v4 and Untitled UI.

```bash
npm install
npm run dev       # http://localhost:5173 (proxies /api to the backend)
npm run build     # type-check + production build
npm run preview   # serve the production build
```

- Routes: `/`, `/remove-background`, `/upscale`, `/crop`, `/editor`, `/whiteboard` and more (`src/routes/AppRoutes.tsx`)
- Whiteboard (`/whiteboard`): the Excalidraw editor in `src/features/whiteboard/`, lazy-loaded, with IndexedDB autosave; its fonts are copied into the build by `vite.config.ts` (see the root README)
- Untitled UI components: `src/components/ui/` — add more with `npx untitledui@latest add <name> -p components/ui`, then change `@/utils/cx` imports to `@/lib/utils/cx`
- Landing page: `src/pages/Home/HomePage.tsx` composes the sections in `src/components/landing/`. Its demos (background removal, before/after, upscale loupe, crop editor) run entirely in the browser on sample photos; nothing is sent to the API.
- Landing photography lives in `src/assets/images/landing/` (CC0, credits in `CREDITS.md`). The cut-outs are real output from a segmentation model (BiRefNet-lite via `rembg`), not hand-made masks.
- Tools: `/remove-background` and `/upscale` share `src/features/image-processing/` (workspace, processing-job hook, drop/paste support). The image picked on the landing page carries into the tools and between them.
- Crop (`/crop`) and Editor (`/editor`) live in `src/features/editor/` and run entirely in the browser — nothing is uploaded. The crop frame, straighten dial and view use Apple-style springs (`spring.ts`: damping/response, velocity hand-off, momentum projection, rubber-banding). Edits are one session per image with undo/redo (`useEditStore`), shared between the two pages. Preview and export use the same colour matrix (`color.ts`) and one full-resolution resample (`render.ts`), so the download matches what you see.
- "Upload image" validates type, size and decodability (mirroring the backend), keeps the file in the Zustand store and opens the background remover.
- Processing shows real upload progress, then an honest "Processing your image…" (no fake percentages). Results live only in the browser as object URLs and download directly.
- API calls go through `src/lib/api/apiClient.ts` to our backend only. Set `VITE_API_BASE_URL` when the API is hosted on another origin.

See the [root README](../README.md) for the full overview.
