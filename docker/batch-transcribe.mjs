#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STT_API_URL = process.env.STT_API_URL || 'http://192.168.2.166:1488/v1';
const STT_API_KEY = process.env.STT_API_KEY || '';
const STT_MODEL = process.env.STT_MODEL || 'medium';
const STT_LANGUAGE = process.env.STT_LANGUAGE || 'ru';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const INPUT_DIR = process.argv[2] || '.';

if (!STT_API_KEY) {
    console.error('Error: STT_API_KEY not set');
    process.exit(1);
}

function findFiles(dir) {
    const results = [];
    
    function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (/\.(ogg|mp4)$/.test(entry.name) && !entry.name.includes('.transcribed')) {
                results.push(fullPath);
            }
        }
    }
    
    walk(dir);
    return results;
}

async function transcribeFile(file) {
    const output = `${file}.transcribed.txt`;
    
    if (fs.existsSync(output)) {
        console.log(`[SKIP] Already transcribed: ${file}`);
        return { success: true, skipped: true };
    }
    
    console.log(`[START] Transcribing: ${file}`);
    
    const tempFile = fs.mkdtempSync(null) + '.txt';
    
    return new Promise((resolve) => {
        const curl = spawn('curl', [
            '-s', '-X', 'POST',
            `${STT_API_URL}/audio/transcriptions`,
            '-H', `Authorization: Bearer ${STT_API_KEY}`,
            '-F', `file=@${file}`,
            '-F', `model=${STT_MODEL}`,
            '-F', `language=${STT_LANGUAGE}`,
            '-F', 'response_format=text',
            '--max-time', '300',
            '-o', tempFile,
            '-w', '%{http_code}'
        ]);
        
        let httpCode = '';
        
        curl.stdout.on('data', (data) => {
            httpCode += data.toString();
        });
        
        curl.on('close', (code) => {
            if (code === 0 && httpCode.trim() === '200') {
                fs.renameSync(tempFile, output);
                console.log(`[DONE] ${file} -> ${output}`);
                resolve({ success: true, skipped: false });
            } else {
                try { fs.unlinkSync(tempFile); } catch {}
                console.error(`[FAIL] ${file} (HTTP ${httpCode.trim() || 'unknown'})`);
                resolve({ success: false, skipped: false });
            }
        });
        
        curl.on('error', (err) => {
            try { fs.unlinkSync(tempFile); } catch {}
            console.error(`[FAIL] ${file}: ${err.message}`);
            resolve({ success: false, skipped: false });
        });
    });
}

async function processBatch(files, concurrency) {
    const results = [];
    
    for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        console.log(`Processing batch ${Math.floor(i / concurrency) + 1} (${batch.length} files)...`);
        
        const batchResults = await Promise.all(batch.map(f => transcribeFile(f)));
        results.push(...batchResults);
        
        const processed = results.length;
        const errors = results.filter(r => !r.success).length;
        console.log(`Progress: ${processed}/${files.length} (errors: ${errors})`);
    }
    
    return results;
}

async function main() {
    console.log(`STT API: ${STT_API_URL}`);
    console.log(`Model: ${STT_MODEL}, Language: ${STT_LANGUAGE}`);
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log(`Input directory: ${INPUT_DIR}`);
    console.log('');
    
    const files = findFiles(INPUT_DIR);
    console.log(`Found ${files.length} files to transcribe\n`);
    
    if (files.length === 0) {
        console.log('No files to process');
        process.exit(0);
    }
    
    const results = await processBatch(files, BATCH_SIZE);
    
    const errors = results.filter(r => !r.success).length;
    const skipped = results.filter(r => r.skipped).length;
    
    console.log(`\nDone. Processed: ${results.length}, Skipped: ${skipped}, Errors: ${errors}`);
    process.exit(errors > 0 ? 1 : 0);
}

main().catch(console.error);
