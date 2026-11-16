import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('./client',import.meta.url)),
 publicDir:root+'public',
 css:{postcss:root},
 resolve:{alias:{'@':root}},
 build:{outDir:root+'local-dist',emptyOutDir:true},
});
