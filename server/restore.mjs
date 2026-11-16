import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {restoreBackup} from './backups.mjs';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
if(!args.includes('--file')||!args.includes('--output'))throw new Error('Usage: npm run restore -- --file backup.rrbackup --output NEW-database.sqlite [--key data/security.key]');
const key=readFileSync(resolve(args.includes('--key')?value('--key'):'data/security.key'));if(key.length!==32)throw new Error('Invalid key file.');
const output=await restoreBackup({file:value('--file'),output:value('--output'),key});console.log(`Verified backup restored to ${output}. Sessions were revoked. Stop the server before switching database paths.`);
