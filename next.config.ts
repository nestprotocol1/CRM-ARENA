import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // PGlite trae WASM: si Next lo bundlea, el HMR termina resolviendo mal la
  // ruta del binario. Externalizado, se carga como paquete de Node estable.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
