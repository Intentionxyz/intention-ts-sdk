// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "tsup";

export default defineConfig([
    // CommonJS build
    {
        entry: ["src/index.ts"],
        format: ["cjs"],
        dts: false,
        splitting: false,
        sourcemap: false,
        clean: false,
        outDir: "dist/common",
        outExtension() {
            return { js: ".js" };
        },
    },
    // ESM build
    {
        entry: ["src/index.ts"],
        format: ["esm"],
        dts: false,
        splitting: false,
        sourcemap: false,
        clean: false,
        outDir: "dist/esm",
        outExtension() {
            return { js: ".mjs" };
        },
    },
]);
